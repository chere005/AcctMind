# shellcheck shell=sh
# The heavy-build lock: ONE heavy build at a time on this machine, kept by the
# machine rather than by whoever remembers the rule. Sourced, never run:
#
#   . tools/heavy-lock.sh
#   heavy_lock "iOS"      waits its turn, then holds the lock
#   ...                   xcodebuild, gradle, tauri/cargo, expo prebuild, pods
#   heavy_unlock          or just exit — EXIT, INT and TERM release it too
#
# WHY IT EXISTS. "One heavy build at a time" is in the baseline AGENTS.md and
# in every app's, and on 2026-09-30 two sessions broke it anyway: one lane's
# gradle ran beside another session's xcodebuild, neither able to see the
# other. The AcctMind dtp --quick that takes 246 s on a quiet machine took
# 689 s and then 1574 s — cargo 84 s instead of 18, gradle 412 s instead of
# 95. Waiting costs the other build's remaining minutes; overlapping costs
# both builds three to six times over, and has cost a build outright (a flaky
# WebKit run under load, an emulator that died when gradle and xcodebuild
# overlapped). A rule two agents have to remember is a rule nobody is keeping.
#
# WHAT IT IS. A directory, because mkdir is atomic: of any number of processes
# asking at once, exactly one gets it. It sits at a FIXED per-user path outside
# every repo, because the whole point is that two checkouts, two sessions and
# two terminals all find the same one — $TMPDIR would not do, since a sandboxed
# session is handed its own. `owner` inside it says who holds it (pid, that
# pid's start time, when, which repo, which step), so a waiter can say what it
# is waiting for and can tell a holder that has gone.
#
# A WAIT, NOT A FAILURE. A step that finds the lock held waits for it, saying
# who holds it every 30 s and looking every 2. After MIND_HEAVY_WAIT seconds
# (30 minutes unless set) it gives up and fails the step the way any failure
# there fails. The longest a holder has needed is CalMind's iOS and Android
# back to back, 6m48s on 2026-09-30, under a quarter of that — so a wait that
# long means a holder that is stuck, and a person should look.
#
# A HOLDER THAT IS GONE is taken over, never waited out. Gone means its pid is
# not running — or is running as some OTHER process, which is why the start
# time is kept beside it: pids are reused, and a recycled one would otherwise
# hold a dead build's lock until the timeout. kill -9 runs no trap and leaves
# the directory behind; this is what clears it. What it cannot see is the
# child: a script killed -9 on its own leaves its xcodebuild or gradle running,
# orphaned, and the next build starts beside it. Ctrl-C does not leave that
# hole (it stops the whole foreground group), and neither does TERM (see the
# traps, below); kill -9 is a person's deliberate act, and theirs to tidy.
#
# NOT RE-ENTRANT, ON PURPOSE. A heavy block that starts another heavy block
# would wait for itself, so the holder being this shell or one of its
# ancestors is an immediate, loud error instead of a 30-minute hang.
#
# Call both from the script's own shell, not from a ( subshell ) or a
# background job: the lock is held in the name of $$, which a subshell shares
# with its parent.
#
# MIND_HEAVY_LOCK moves the lock, and exists for the proofs in CoreMind's
# bin/check-heavy-lock.sh, which must not queue behind (or block) a real
# build. A lane never sets it: two builds with two locks are two builds that
# overlap.

HEAVY_LOCK="${MIND_HEAVY_LOCK:-/tmp/mind-heavy-$(id -u).lock}"
HEAVY_WAIT="${MIND_HEAVY_WAIT:-1800}"
_hl_tab=$(printf '\t')
_hl_held=0

# The start time of pid $1, one space between words, or "-" when ps cannot
# say. Compared as a string, so both sides go through this one function.
_hl_start() {
  _hl_s=$(ps -o lstart= -p "$1" 2>/dev/null | sed 's/  */ /g; s/^ //; s/ $//') || _hl_s=""
  printf '%s\n' "${_hl_s:--}"
}

# Is pid $1 still the process that took the lock at start time $2? A zombie
# counts as gone: it has finished, and only its parent's reaping is late.
_hl_alive() {
  _hl_st=$(ps -o stat= -p "$1" 2>/dev/null) || return 1
  case "$_hl_st" in ''|*Z*) return 1 ;; esac
  [ "$2" = - ] && return 0
  [ "$(_hl_start "$1")" = "$2" ]
}

# Is pid $1 this shell's parent, or its parent's, and so on up?
_hl_ancestor() {
  _hl_p=$$
  while :; do
    _hl_p=$(ps -o ppid= -p "$_hl_p" 2>/dev/null | tr -d ' ')
    case "$_hl_p" in ''|0|1) return 1 ;; esac
    [ "$_hl_p" = "$1" ] && return 0
  done
}

# One line per acquire, release, takeover and give-up, beside the lock — the
# record that says, after the fact, whether two builds ever overlapped.
_hl_log() {
  printf '%s\t%s\t%s\t%s: %s\n' "$(date +%s)" "$1" "$$" "$_hl_repo" "$_hl_step" \
    >>"$HEAVY_LOCK.log" 2>/dev/null || true
}

# THE STATUS CARD. Under bin/dtp.sh the batch's beat posts whatever
# MIND_PHASE_FILE says once a minute, so a lane waiting here would otherwise
# read as "building" on the card while it builds nothing. Written only when the
# file already exists (the run owns it, and removes it when it ends), and put
# back exactly as it was once the wait is over.
_hl_phased=0
_hl_phase_set() {
  [ -n "${MIND_PHASE_FILE:-}" ] && [ -f "$MIND_PHASE_FILE" ] || return 0
  if [ "$_hl_phased" = 0 ]; then
    _hl_phase0=$(cat "$MIND_PHASE_FILE" 2>/dev/null) || _hl_phase0=""
    _hl_phased=1
  fi
  printf '%s' "$1" >"$MIND_PHASE_FILE" 2>/dev/null || true
}
_hl_phase_restore() {
  [ "$_hl_phased" = 1 ] || return 0
  _hl_phased=0
  [ -f "$MIND_PHASE_FILE" ] || return 0
  printf '%s' "$_hl_phase0" >"$MIND_PHASE_FILE" 2>/dev/null || true
}

# Breaking a dead holder's lock is check-then-remove, and two waiters doing
# that at once could each remove what the other had just taken. So it is done
# under a second, momentary lock, and the owner is read again under it: only a
# lock still held by the SAME dead owner is removed. A breaker holds that for
# milliseconds, so one still there ten seconds on died holding it.
_hl_break() {
  if mkdir "$HEAVY_LOCK.break" 2>/dev/null; then
    _hl_bline=$(cat "$HEAVY_LOCK/owner" 2>/dev/null) || _hl_bline=""
    if [ -d "$HEAVY_LOCK" ] && [ "$_hl_bline" = "$1" ]; then
      rm -rf "$HEAVY_LOCK"
      _hl_log "cleared the lock left by pid ${2:-?}"
    fi
    rmdir "$HEAVY_LOCK.break" 2>/dev/null || true
    _hl_bseen=""
    return 0
  fi
  if [ -z "$_hl_bseen" ]; then
    _hl_bseen=$(date +%s)
  elif [ $(($(date +%s) - _hl_bseen)) -ge 10 ]; then
    rmdir "$HEAVY_LOCK.break" 2>/dev/null || true
    _hl_bseen=""
  fi
  return 0
}

# THE CALLER'S TRAPS. POSIX traps replace each other rather than stacking, so
# a lock that simply set its own would delete the lane's — the beat-killer, the
# status card's failed-3 finish, a temp file's cleanup. So heavy_lock reads
# what is set, installs a handler that releases the lock and then does exactly
# what the caller's would have, and heavy_unlock puts the caller's back.
#
# Read from `trap`'s own listing, written to a FILE: $(trap) reports the
# parent's traps in bash but nothing at all in dash. The listing is quoted by
# the shell for re-input, so it is evaluated with each `trap --` turned into a
# call that records it — no parsing of quotes by hand.
_hl_rec() {
  case "${2#SIG}" in
    EXIT|INT|TERM) eval "_hl_s_${2#SIG}=set; _hl_t_${2#SIG}=\$1" ;;
  esac
}
_hl_read_traps() {
  _hl_s_EXIT=""; _hl_s_INT=""; _hl_s_TERM=""
  _hl_t_EXIT=""; _hl_t_INT=""; _hl_t_TERM=""
  _hl_tf=$(mktemp "${TMPDIR:-/tmp}/heavy-traps.XXXXXX" 2>/dev/null) || return 1
  trap >"$_hl_tf"
  eval "$(sed 's/^trap -- /_hl_rec /' "$_hl_tf")"
  rm -f "$_hl_tf"
}

# What runs on EXIT, INT or TERM while the lock is held ($1 names which).
#
# On EXIT the lock goes, then the caller's EXIT handler runs with the $? it
# would have seen.
#
# On INT or TERM that the caller HANDLES, its handler runs (same $?) and the
# lock stays: a script that carries on past its Ctrl-C is still in its heavy
# block, so it still holds the lock until its heavy_unlock — and if the
# handler exits instead, the EXIT above lets go.
#
# On INT or TERM that it does not, the shell would have died of it, so it
# still does: the lock goes, then the signal is raised again, so Ctrl-C still
# stops the run and a parent still sees an interrupt rather than an exit
# status (bash decides whether ITS Ctrl-C was handled by how the child died).
#
# Dying of the signal is where the two shells differ, and the re-raise has to
# copy whichever this is. bash runs the EXIT trap on its way out of a fatal
# signal, with $? as it stood — but not for one raised from inside a trap, as
# this one is. So under bash the EXIT trap standing now (the caller's, put back
# by the unlock) is run here, with that $?, and then cleared. dash runs no EXIT
# trap on a fatal signal, so under dash neither does this.
#
# One thing a trap changes that cannot be helped: bash runs one only after its
# foreground command finishes, so a TERM sent to a script mid-xcodebuild now
# takes effect when xcodebuild ends rather than orphaning it. For this lock
# that is the right order — the build is still running, so the lock is still
# held. (Ctrl-C reaches the whole foreground group, xcodebuild included, so it
# is not delayed.)
_hl_on() {
  _hl_rc=$?
  eval "_hl_hs=\$_hl_c_s_$1; _hl_ht=\$_hl_c_t_$1"
  if [ "$1" != EXIT ] && [ "$_hl_hs" = set ]; then
    _hl_return "$_hl_rc"
    eval "$_hl_ht"
    return
  fi
  heavy_unlock
  if [ "$1" = EXIT ]; then
    trap - EXIT
    [ "$_hl_hs" = set ] || return 0
    _hl_return "$_hl_rc"
    eval "$_hl_ht"
    return
  fi
  if [ -n "${BASH_VERSION:-}" ] && _hl_read_traps && [ "$_hl_s_EXIT" = set ]; then
    trap - EXIT
    _hl_return "$_hl_rc"
    eval "$_hl_t_EXIT"
  fi
  trap - "$1"
  kill -s "$1" $$
  case "$1" in INT) exit 130 ;; *) exit 143 ;; esac
}
_hl_return() { return "$1"; }

# heavy_lock <step> — wait for the lock, take it, and hold it in this shell's
# name until heavy_unlock or the shell ends. Returns non-zero (having built
# nothing) when it cannot take the lock: a wait that ran out, a lock that
# cannot be created, a heavy block nested inside another.
heavy_lock() {
  if [ "$_hl_held" = 1 ]; then
    echo "heavy_lock: this script already holds the heavy-build lock, for $_hl_step — heavy_unlock first" >&2
    return 1
  fi
  _hl_step=$(printf '%s' "${1:-a heavy build}" | tr '\t\n' '  ')
  _hl_repo=$(git rev-parse --show-toplevel 2>/dev/null) || _hl_repo=$(pwd)
  _hl_repo=$(basename "$_hl_repo")
  _hl_me_start=$(_hl_start $$)
  _hl_me="$$$_hl_tab$_hl_me_start$_hl_tab$(date +%s)$_hl_tab$(date +%H:%M:%S)$_hl_tab$_hl_repo$_hl_tab$_hl_step"
  _hl_t0=$(date +%s); _hl_next=0; _hl_waited=0
  _hl_blind=0; _hl_lone=""; _hl_bseen=""; _hl_seen=""
  while :; do
    if _hl_err=$(mkdir "$HEAVY_LOCK" 2>&1); then
      # Written beside, then renamed in: a reader sees no owner or a whole one,
      # never half a line.
      if printf '%s\n' "$_hl_me" >"$HEAVY_LOCK/owner.$$" 2>/dev/null \
         && mv -f "$HEAVY_LOCK/owner.$$" "$HEAVY_LOCK/owner" 2>/dev/null; then
        [ "$(cat "$HEAVY_LOCK/owner" 2>/dev/null)" = "$_hl_me" ] && break
        continue
      fi
      rm -rf "$HEAVY_LOCK"
      echo "heavy_lock: took $HEAVY_LOCK but could not write its owner — not building under a lock that cannot say whose it is" >&2
      _hl_phase_restore
      return 1
    fi

    # mkdir failing with nothing there is not "someone has it": /tmp is not
    # writable (a sandboxed session), or a file sits on the path. Looping on
    # that as if it were a holder would wait 30 minutes for nobody. Asked three
    # times, a second apart, in case a holder let go between the two looks.
    if [ ! -d "$HEAVY_LOCK" ]; then
      _hl_blind=$((_hl_blind + 1))
      if [ "$_hl_blind" -ge 3 ]; then
        echo "heavy_lock: cannot create $HEAVY_LOCK — not building without the heavy-build lock" >&2
        echo "    $_hl_err" >&2
        _hl_phase_restore
        return 1
      fi
      sleep 1
      continue
    fi
    _hl_blind=0

    _hl_line=$(cat "$HEAVY_LOCK/owner" 2>/dev/null) || _hl_line=""
    if [ -z "$_hl_line" ]; then
      # Taken, owner not yet written: the taker is between its mkdir and its
      # rename — microseconds — or died there. Ten seconds of it staying that
      # way says which.
      if [ -z "$_hl_lone" ]; then
        _hl_lone=$(date +%s)
      elif [ $(($(date +%s) - _hl_lone)) -ge 10 ]; then
        echo "==> the heavy-build lock has had no owner for 10s — its taker died taking it; taking it over" >&2
        _hl_break "" ""
        _hl_lone=""
        continue
      fi
      sleep 1
      continue
    fi
    _hl_lone=""
    IFS="$_hl_tab" read -r _hl_opid _hl_ostart _hl_oepoch _hl_ohms _hl_orepo _hl_ostep <<EOF
$_hl_line
EOF

    if [ "$_hl_opid" = "$$" ] && [ "$_hl_ostart" = "$_hl_me_start" ]; then
      echo "heavy_lock: the heavy-build lock is already held in this shell's name, for $_hl_ostep — a subshell or background job took it; not waiting for myself" >&2
      _hl_phase_restore
      return 1
    fi
    if ! _hl_alive "$_hl_opid" "$_hl_ostart"; then
      echo "==> the heavy-build lock was left by $_hl_orepo: $_hl_ostep (pid $_hl_opid, since $_hl_ohms), which is no longer running — taking it over" >&2
      _hl_break "$_hl_line" "$_hl_opid"
      continue
    fi
    if [ "$_hl_line" != "$_hl_seen" ]; then
      _hl_seen=$_hl_line
      if _hl_ancestor "$_hl_opid"; then
        echo "heavy_lock: the heavy-build lock is held by this run's own parent (pid $_hl_opid, $_hl_orepo: $_hl_ostep) — a heavy block nested inside another would wait for itself" >&2
        _hl_phase_restore
        return 1
      fi
    fi

    _hl_now=$(date +%s)
    _hl_waited=$((_hl_now - _hl_t0))
    if [ "$_hl_waited" -ge "$HEAVY_WAIT" ]; then
      echo "heavy_lock: gave up after ${_hl_waited}s waiting for the heavy-build lock, still held by $_hl_orepo: $_hl_ostep (pid $_hl_opid) since $_hl_ohms — nothing was built; run it again once that has finished" >&2
      _hl_log "gave up after ${_hl_waited}s, held by pid $_hl_opid"
      _hl_phase_restore
      return 1
    fi
    if [ "$_hl_now" -ge "$_hl_next" ]; then
      echo "==> waiting for the heavy-build lock — held by $_hl_orepo: $_hl_ostep (pid $_hl_opid) since $_hl_ohms; ${_hl_waited}s so far" >&2
      _hl_phase_set "$_hl_repo: $_hl_step — waiting for the heavy-build lock, held by $_hl_orepo: $_hl_ostep since $_hl_ohms"
      _hl_next=$((_hl_now + 30))
    fi
    sleep 2
  done

  _hl_held=1
  _hl_phase_restore
  _hl_waited=$(($(date +%s) - _hl_t0))
  if [ "$_hl_waited" -gt 0 ] && [ -n "$_hl_seen$_hl_lone" ]; then
    echo "==> heavy-build lock taken after ${_hl_waited}s" >&2
  fi
  _hl_log acquired

  # Ours around theirs. Traps that cannot be read are left alone rather than
  # guessed at — the lock then goes when the shell does, by the takeover above,
  # which is slower and clobbers nothing. A signal the caller IGNORES ('' as
  # its trap) stays ignored: installing a handler would un-ignore it. And one
  # of OURS still standing (an unlock that could not read the traps back) is
  # not the caller's to save: wrapping it would make the handler call itself.
  _hl_read_traps || return 0
  for _hl_sig in EXIT INT TERM; do
    eval "_hl_cs=\$_hl_s_$_hl_sig; _hl_ct=\$_hl_t_$_hl_sig"
    if [ "$_hl_ct" != "_hl_on $_hl_sig" ]; then
      eval "_hl_c_s_$_hl_sig=\$_hl_cs; _hl_c_t_$_hl_sig=\$_hl_ct"
      if [ "$_hl_cs" = set ] && [ -z "$_hl_ct" ]; then continue; fi
    fi
    trap "_hl_on $_hl_sig" "$_hl_sig"
  done
  return 0
}

# heavy_unlock — let the lock go, if this shell holds it; otherwise nothing.
# Safe to call twice, and from the caller's own trap.
#
# The caller's traps come back only where OURS is still the one installed. A
# trap the caller set inside the block (CalMind's iOS step sets one for a temp
# file) is theirs now, and putting the old one back would delete it.
heavy_unlock() {
  [ "$_hl_held" = 1 ] || return 0
  _hl_held=0
  _hl_line=$(cat "$HEAVY_LOCK/owner" 2>/dev/null) || _hl_line=""
  if [ "$_hl_line" = "$_hl_me" ]; then
    rm -rf "$HEAVY_LOCK"
    _hl_log released
  else
    echo "heavy_unlock: the heavy-build lock is no longer held in this shell's name — leaving it as it is" >&2
  fi
  _hl_read_traps || return 0
  for _hl_sig in EXIT INT TERM; do
    eval "_hl_ct=\$_hl_t_$_hl_sig"
    [ "$_hl_ct" = "_hl_on $_hl_sig" ] || continue
    eval "_hl_cs=\$_hl_c_s_$_hl_sig; _hl_ct=\$_hl_c_t_$_hl_sig"
    if [ "$_hl_cs" = set ]; then
      trap -- "$_hl_ct" "$_hl_sig"
    else
      trap - "$_hl_sig"
    fi
  done
  return 0
}
