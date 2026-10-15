// node --test test/   — unit test for ui/reach.js (the reach scanner). Zero dependencies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanReach, describeReach, explainReach, REACH_MAX, REACH_KINDS } from '../ui/reach.js';

const one = (text, lang) => { const r = scanReach(text, lang); assert.equal(r.length, 1, `expected one reach in ${JSON.stringify(text)}, got ${JSON.stringify(r)}`); return r[0]; };
const none = (text, lang) => assert.deepEqual(scanReach(text, lang), [], `expected no reach in ${JSON.stringify(text)}`);

test('the bare verbs: ping, dns, browser, research, agent, hermes, shell, say, ask', () => {
  assert.deepEqual(one("ping('google.com')", 'python'), { line: 1, kind: 'net', name: 'ping', args: ['google.com'], raw: "ping('google.com')" });
  assert.equal(one('dns("example.org")', 'pseudo').kind, 'net');
  assert.equal(one('claude_browser("https://example.com")').kind, 'browser');
  assert.equal(one('research("quantum dots", depth=2)').kind, 'research');
  assert.deepEqual(one('research("quantum dots", depth=2)').args, ['quantum dots', 'depth=2']);
  assert.equal(one('agent("summarize the repo")').kind, 'agent');
  assert.equal(one('hermes("review this driver")').kind, 'hermes');
  assert.equal(one('shell("ls -la")').kind, 'shell');
  assert.equal(one('say("hi there")').kind, 'say');
  assert.equal(one('ask("why is this slow?")').kind, 'ask');
  assert.equal(one('search("best ssd 2026")').kind, 'search');
  assert.equal(one('http.get("https://api.example.com/x")', 'python').name, 'http.get');
});

test('the claude namespace counts with any verb, once per call', () => {
  const r = one('x = claude.browser("https://example.com")', 'python');
  assert.equal(r.kind, 'browser');
  assert.equal(r.name, 'claude.browser');
  assert.deepEqual(r.args, ['https://example.com']);
  assert.equal(one('claude.whatever(1, 2)').kind, 'claude');
  assert.equal(one('claude.whatever(1, 2)').name, 'claude.whatever');
  assert.equal(one('claude_browser("https://x")').name, 'claude.browser');        // the underscore spelling, no double count
  assert.equal(one('claude.ping("8.8.8.8")').kind, 'net');
  assert.equal(one('claude.research("topic")').kind, 'research');
});

test('what the sandbox does itself is not a reach: fetch in javascript, a verb the document defines, a method of the same name', () => {
  none("fetch('https://api.example.com')", 'javascript');
  none("await fetch('https://api.example.com')", 'typescript');
  assert.equal(one("fetch('https://api.example.com')", 'python').kind, 'net');
  assert.equal(one("fetch('https://api.example.com')", 'pseudo').kind, 'net');
  none("def ping(host):\n    print('ping', host)\n\nping('google.com')", 'python');
  none("function ping(host) { console.log(host) }\nping('google.com')", 'javascript');
  none("const ping = (host) => host\nping('google.com')", 'javascript');
  none("ping = lambda h: h\nping('x')", 'python');
  none('re.exec(s)', 'javascript');
  none('list.search(x)', 'python');
  none('$obj.search(x)', 'pseudo');
  none('results.fetch(1)', 'python');
});

test('pseudo-code without parentheses, and shell lines', () => {
  assert.deepEqual(one('ping google.com', 'pseudo'), { line: 1, kind: 'net', name: 'ping', args: ['google.com'], raw: 'ping google.com' });
  assert.equal(one('  browse https://example.com').kind, 'browser');
  assert.equal(one('research the history of morse code').kind, 'research');
  assert.deepEqual(one('$ ls -la'), { line: 1, kind: 'shell', name: '$', args: ['ls -la'], raw: '$ ls -la' });
  assert.equal(one('! dir').kind, 'shell');
  none('$x = 1', 'php');
  none('$x=1');
  none('search the list for the max', 'pseudo');
  none('open the file', 'pseudo');
  none('ping', 'pseudo');
});

test('comments and ?? lines are skipped', () => {
  none('# ping google.com', 'python');
  none('// claude.browser("x")', 'javascript');
  none('-- ping google.com', 'sql');
  none('?? what does ping("x") do', 'python');
  none('   ', 'python');
  none('', 'python');
});

test('the real libraries the sandbox blocks, by language family', () => {
  assert.equal(one('r = requests.get(url)', 'python').name, 'requests');
  assert.equal(one('r = requests.get(url)', 'py').kind, 'net');
  assert.equal(one('subprocess.run(["ls"])', 'python').kind, 'shell');
  assert.equal(one('subprocess.run(["ls"])', 'python').name, 'subprocess');
  assert.equal(one('os.system("dir")', 'python').name, 'os.system');
  assert.equal(one('webbrowser.open(u)', 'python').kind, 'browser');
  assert.equal(one('s = socket.create_connection((h, 80))', 'python').kind, 'net');
  assert.equal(one('data = urlopen(u).read()', 'python').name, 'urllib');
  assert.equal(one("execSync('ls')", 'javascript').name, 'child_process');
  assert.equal(one("const { exec } = require('child_process')", 'typescript').kind, 'shell');
  assert.equal(one("const browser = await puppeteer.launch()", 'javascript').kind, 'browser');
  none('r = requests.get(url)', 'pseudo');                 // a library name means nothing in pseudo-code
  none('r = requests.get(url)', 'go');
});

test('lines are 1-based and sorted; arguments keep nesting; at most REACH_MAX', () => {
  const text = "import os\n\nhosts = ['a', 'b']\nfor h in hosts:\n    print(ping(h, count=2))\nclaude.browser('https://x')\n";
  const r = scanReach(text, 'python');
  assert.deepEqual(r.map((x) => [x.line, x.name]), [[5, 'ping'], [6, 'claude.browser']]);
  assert.deepEqual(one('ping(host(1), [2, 3], "a,b")').args, ['host(1)', '[2, 3]', 'a,b']);
  assert.deepEqual(one("ping('it\\'s')").args, ["it\\'s"]);               // the escaped quote stays inside; the outer quotes go
  const many = Array.from({ length: REACH_MAX + 20 }, (_, i) => `ping("h${i}")`).join('\n');
  assert.equal(scanReach(many).length, REACH_MAX);
  assert.equal(scanReach(null).length, 0);
  assert.equal(scanReach(undefined, undefined).length, 0);
});

test('long lines are clipped and two calls on one line both count', () => {
  const long = `ping("${'x'.repeat(500)}")`;
  const r = one(long);
  assert.ok(r.args[0].length <= 200 && r.args[0].endsWith('…'));
  assert.ok(r.raw.length <= 200);
  const two = scanReach('say(ping("a"))');
  assert.deepEqual(two.map((x) => x.name), ['say', 'ping']);
});

test('describeReach and explainReach read like a line', () => {
  const r = one("ping('google.com')");
  assert.equal(describeReach(r), 'ping google.com');
  assert.equal(explainReach(r), 'ping google.com — reaches the network. Claude does it for real when you Run.');
  assert.equal(describeReach(one('research("x", "y")')), 'research x, y');
  assert.equal(describeReach({ name: 'claude.go', args: [] }), 'claude.go');
  assert.ok(explainReach({ kind: 'nope', name: 'z', args: [] }).includes(REACH_KINDS.claude));
});
