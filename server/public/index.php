<?php
declare(strict_types=1);

/**
 * The AcctMind doorway — the whole server side of this app.
 *
 * AcctMind stores nothing on the server. Every transaction lives in the
 * browser's own storage, so there is no API here, no database, and no user
 * data for this file to protect. What it does is decide whether to hand over
 * the app at all, and it reuses the live suite's sign-in to decide: the same
 * accounts, the same session cookie, no second password to keep.
 *
 * How the reuse works, and why it is only these few lines:
 *
 *   · The suite's production session cookie is set at path '/', so a page at
 *     /AcctMind is already inside its scope. Someone signed into the suite is
 *     signed in here, with nothing to hand between them.
 *   · `render_login()` posts to `_self_path()` — the URL it was rendered at —
 *     so the form submits back HERE. That is why this file handles the POST
 *     itself instead of calling `require_login()`: that function redirects a
 *     fresh sign-in to LOGIN_LANDING (/calmind/calendar/), which would bounce
 *     someone off AcctMind at the one moment they were trying to reach it.
 *     Everything else — the account store, the form, the session — is the
 *     suite's.
 *
 * What this DOES NOT gate: the JavaScript bundle under _expo/, which Apache
 * serves directly. That is deliberate and safe — the bundle is program text
 * with no data in it, and the ledger it reads is on the visitor's own device.
 * The app SHELL is not in the web root at all (see $shell below), so there is
 * no second door into the page itself.
 *
 * Credential handling is the SUITE's, not this app's. AcctMind never stores a
 * password and never decides what counts as a match.
 */

// ---------------------------------------------------------------- instance
//
// Which instance this is, derived from where the file is INSTALLED rather
// than from a config someone has to keep in step. Production and the sandbox
// get separate libs, separate data and separate app shells, exactly as the
// suite splits lib/lib-test and data/data-test — so a sandbox sign-in is not
// a production sign-in, and neither one can read the other's shell.
//
// The env vars exist for the test harness, which runs this file on a scratch
// directory with no /home/protected at all. The web server never sets them.
$isTest = str_starts_with(__DIR__, '/home/public/test/');

$lib = getenv('ACCTMIND_LIB');
if (!is_string($lib) || $lib === '') {
    $lib = $isTest ? '/home/protected/lib-test' : '/home/protected/lib';
}

$shell = getenv('ACCTMIND_SHELL');
if (!is_string($shell) || $shell === '') {
    $shell = $isTest ? '/home/protected/acctmind-test/app.html'
                     : '/home/protected/acctmind/app.html';
}

if (!is_file($lib . '/auth.php')) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    exit("AcctMind: the suite's auth library is not at $lib.\n"
       . "This app signs people in with the CalMind suite's accounts and cannot start without it.\n");
}
require_once $lib . '/auth.php';

/**
 * `e()` — HTML escaping, which `render_login()` calls but `auth.php` does not
 * define.
 *
 * An implicit contract of the suite, found the hard way: every app in
 * seancheren-site defines its own `e()` at the top of its page, and
 * `render_login()` simply assumes the caller did. Without this, the login
 * screen dies halfway through its own <head> with "Call to undefined
 * function e()" — a fatal that renders as a broken page rather than an error,
 * because the status line has already gone out.
 *
 * Guarded, so that a future suite version which does define it wins instead
 * of colliding.
 */
if (!function_exists('e')) {
    function e(?string $s): string { return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8'); }
}

// ----------------------------------------------------------------- session
session_boot();

/** This page's own URL, for redirects that must stay on AcctMind. */
$self = strtok((string) ($_SERVER['REQUEST_URI'] ?? '/'), '?');

if (isset($_GET['logout'])) {
    usage_log('logout');
    $_SESSION = [];
    session_destroy();
    header('Location: ' . $self);
    exit;
}

// ------------------------------------------------------------------- login
//
// The same check the suite makes, against the same store, landing back here.
$error = '';
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST'
    && isset($_POST['username'], $_POST['password'])) {
    $cfg  = app_config();
    $user = (string) $_POST['username'];
    $pass = (string) $_POST['password'];
    $want = auth_password_for($cfg, $user);

    // hash_equals, not '===': the comparison takes the same time whether the
    // first character is wrong or the last one is. Copied from the suite,
    // where it is the same call for the same reason.
    if ($want !== null && hash_equals($want, $pass)) {
        // A new id on sign-in, so a session id someone else already holds
        // cannot be promoted to an authenticated one.
        session_regenerate_id(true);
        $_SESSION['auth'] = true;
        $_SESSION['user'] = $user;
        usage_log('login', $user);
        // POST -> redirect -> GET: a reload after signing in must not re-post
        // the password.
        header('Location: ' . $self);
        exit;
    }

    usage_log('login_fail', $user);
    // One message for both cases. Saying "no such user" tells anyone asking
    // which usernames exist.
    $error = 'Invalid username or password.';
}

if (empty($_SESSION['auth'])) {
    // 401, not 200: a signed-out fetch of this page should read as refused,
    // and an uptime check should not call the login screen a healthy app.
    http_response_code(401);
    render_login('AcctMind', $error);
    exit;
}

// ------------------------------------------------------------------- serve
//
// The shell lives OUTSIDE the web root, so /AcctMind/app.html is not a way
// around any of the above. It is Expo's export with the head patch applied;
// `deploy.sh` puts it there and never leaves an index.html in the web root
// (Apache's DirectoryIndex would serve that ahead of this file and skip the
// sign-in entirely — see tools/check-deploy-guards.sh, which proves it).
if (!is_file($shell)) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    exit("AcctMind: the app shell is missing at $shell. Re-run deploy.sh.\n");
}

header('Content-Type: text/html; charset=utf-8');
// The shell must always revalidate. The bundle it names is content-hashed and
// cached forever, so a stale shell is a phone running last week's app.
header('Cache-Control: no-cache');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
readfile($shell);
