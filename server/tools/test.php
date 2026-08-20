<?php
declare(strict_types=1);

/**
 * The server suite: real PHP, real HTTP, real cookies, on a scratch directory.
 *
 * It drives `server/public/index.php` against the REAL suite auth library
 * from seancheren-site — not a stand-in. A stub would be testing this
 * harness's idea of how sign-in works, which is precisely the check that
 * passes whether or not the thing it guards is broken. If the suite's lib is
 * not on this machine, the run FAILS and says so rather than skipping.
 *
 *   php server/tools/test.php
 *   SUITE_LIB=/path/to/seancheren-site/lib php server/tools/test.php
 *
 * Nothing here touches a real data directory, a real account, or the network.
 */

$root  = dirname(__DIR__, 2);
// The suite checked out beside this repo, which is how it is usually laid
// out. SUITE_LIB overrides it; nothing here assumes a particular machine.
$lib   = getenv('SUITE_LIB') ?: dirname($root) . '/seancheren-site/lib';
$port  = (int) (getenv('PORT') ?: 8799);

if (!is_file($lib . '/auth.php')) {
    fwrite(STDERR,
        "server suite: the suite's auth library is not at $lib.\n"
      . "AcctMind's sign-in IS the suite's sign-in, so this suite tests against the real\n"
      . "thing. Point SUITE_LIB at the suite's lib/ directory, or clone it beside this\n"
      . "repo. (Refusing to stub it:\n"
      . "a mocked auth check here would pass whether or not the doorway actually works.)\n");
    exit(1);
}

// ------------------------------------------------------------ the scratch instance
$tmp = sys_get_temp_dir() . '/acctmind-test-' . getmypid();
$web = "$tmp/web";
@mkdir($web . '/_expo', 0700, true);
@mkdir("$tmp/data", 0700, true);
@mkdir("$tmp/shell", 0700, true);
register_shutdown_function(static function () use ($tmp) { rrm($tmp); });

copy("$root/server/public/index.php", "$web/index.php");
file_put_contents("$tmp/shell/app.html", "<!doctype html><title>AcctMind</title><div id=\"root\">ACCTMIND-SHELL</div>");
file_put_contents("$web/_expo/bundle.js", "console.log('bundle')");

// Seed one account through the suite's own API, so the store is written the
// way the suite writes it rather than the way this file imagines it does.
putenv("SUITE_DATA_DIR=$tmp/data");
require_once $lib . '/auth.php';
$cfg = app_config();
accounts_save($cfg, ['tester' => ['password' => 'correct horse']]);
auth_password_set($cfg, 'tester', 'correct horse');

// ------------------------------------------------------------------ the server
$env = "SUITE_DATA_DIR=$tmp/data ACCTMIND_LIB=" . escapeshellarg($lib)
     . ' ACCTMIND_SHELL=' . escapeshellarg("$tmp/shell/app.html");
$srv = proc_open(
    "$env exec php -S 127.0.0.1:$port -t " . escapeshellarg($web) . ' 2>/dev/null',
    [1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes, null, null, ['bypass_shell' => false]);
register_shutdown_function(static function () use ($srv) { if (is_resource($srv)) { proc_terminate($srv, SIGKILL); } });
for ($i = 0; $i < 100 && @fsockopen('127.0.0.1', $port) === false; $i++) { usleep(50_000); }

// ------------------------------------------------------------------- the checks
$pass = 0; $fail = 0;

/** GET/POST with a cookie jar, returning [status, headers, body]. */
function req(string $path, ?array $post = null, ?string $jar = null): array {
    global $port;
    $cmd = 'curl -s -i -o - -w "\n@@%{http_code}" --max-time 10';
    if ($jar !== null) { $cmd .= ' -c ' . escapeshellarg($jar) . ' -b ' . escapeshellarg($jar); }
    if ($post !== null) {
        foreach ($post as $k => $v) { $cmd .= ' --data-urlencode ' . escapeshellarg("$k=$v"); }
    }
    $cmd .= ' ' . escapeshellarg("http://127.0.0.1:$port$path");
    $out = (string) shell_exec($cmd);
    $at = strrpos($out, "\n@@");
    $code = (int) substr($out, $at + 3);
    $raw = substr($out, 0, $at);
    // Follow-free: we assert on the redirect itself.
    [$head, $body] = array_pad(preg_split("/\r?\n\r?\n/", $raw, 2), 2, '');
    return [$code, $head, $body];
}

function check(string $what, bool $ok, string $detail = ''): void {
    global $pass, $fail;
    if ($ok) { $pass++; echo "  ok   $what\n"; }
    else { $fail++; echo "  FAIL $what" . ($detail !== '' ? "\n       $detail" : '') . "\n"; }
}

echo "server suite (real suite lib at $lib)\n";

$jar = "$tmp/cookies.txt";

// --- signed out ------------------------------------------------------------
[$code, , $body] = req('/');
check('signed out: answers 401, not 200', $code === 401, "got $code");
check('signed out: the app shell is NOT sent', !str_contains($body, 'ACCTMIND-SHELL'));
check('signed out: a login form is', str_contains($body, 'password') && str_contains($body, '<form'));

// --- wrong password --------------------------------------------------------
[$code, , $body] = req('/', ['username' => 'tester', 'password' => 'wrong'], $jar);
check('wrong password: refused', $code === 401, "got $code");
check('wrong password: no shell', !str_contains($body, 'ACCTMIND-SHELL'));
check('wrong password: says so', str_contains($body, 'Invalid username or password'));

// --- unknown user tells you nothing extra ----------------------------------
[, , $body2] = req('/', ['username' => 'nobody-at-all', 'password' => 'wrong'], "$tmp/j2.txt");
check('an unknown username gets the SAME message as a wrong password',
    str_contains($body2, 'Invalid username or password'));

// --- right password --------------------------------------------------------
[$code, $head, ] = req('/', ['username' => 'tester', 'password' => 'correct horse'], $jar);
check('right password: redirects rather than rendering', $code === 302, "got $code");
check('right password: redirects back to AcctMind, not the calendar',
    (bool) preg_match('~^Location:\s*/\s*$~mi', $head), trim($head));

// --- signed in -------------------------------------------------------------
[$code, $head, $body] = req('/', null, $jar);
check('signed in: 200', $code === 200, "got $code");
check('signed in: the shell is served', str_contains($body, 'ACCTMIND-SHELL'));
check('signed in: the shell is told not to cache', (bool) preg_match('~Cache-Control:.*no-cache~i', $head));
check('signed in: nosniff is set', (bool) preg_match('~X-Content-Type-Options:\s*nosniff~i', $head));

// --- the session is what carries it ---------------------------------------
[$code, , $body] = req('/');                       // no jar: a different visitor
check('another visitor with no cookie is still signed out', $code === 401 && !str_contains($body, 'ACCTMIND-SHELL'));

// --- logout ----------------------------------------------------------------
req('/?logout=1', null, $jar);
[$code, , $body] = req('/', null, $jar);
check('after logout: signed out again', $code === 401 && !str_contains($body, 'ACCTMIND-SHELL'));

// --- no path hands out the shell to a stranger ----------------------------
//
// The status codes here are PHP's built-in server, which falls through to
// index.php for a missing file rather than 404ing as Apache would. So the
// assertion is the one that holds on BOTH: whatever the path, a signed-out
// visitor never receives the shell. That the deploy leaves no index.html in
// the web root — the DirectoryIndex bypass — is a filesystem fact, and
// tools/check-deploy-guards.sh is where it is proven.
foreach (['/app.html', '/index.html', '/../shell/app.html', '/?logout=0'] as $path) {
    [, , $body] = req($path);
    check("signed out, $path does not hand over the shell", !str_contains($body, 'ACCTMIND-SHELL'));
}
check('the shell file is not in the web root at all', !is_file("$web/app.html") && !is_file("$web/index.html"));

// --- a missing shell is loud ----------------------------------------------
// Sign back in first: the logout above emptied the jar, and a 401 here would
// pass this check for entirely the wrong reason.
req('/', ['username' => 'tester', 'password' => 'correct horse'], $jar);
rename("$tmp/shell/app.html", "$tmp/shell/app.html.moved");
[$code, , $body] = req('/', null, $jar);
check('a missing shell is a 500 that says what is missing',
    $code === 500 && str_contains($body, 'app shell is missing'), "got $code");
rename("$tmp/shell/app.html.moved", "$tmp/shell/app.html");

echo "\n$pass passed, $fail failed\n";
exit($fail === 0 ? 0 : 1);

function rrm(string $p): void {
    if (!file_exists($p)) return;
    if (is_dir($p)) { foreach (scandir($p) as $f) { if ($f !== '.' && $f !== '..') rrm("$p/$f"); } @rmdir($p); }
    else @unlink($p);
}
