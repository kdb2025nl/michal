'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { compareTranscript } = require('../server/voicecheck');

test('identical text passes (case/punctuation insensitive)', () => { assert.ok(compareTranscript('See your overdue invoices.', 'see your overdue invoices').pass); });
test('missing words are reported', () => { const r = compareTranscript('Decide which accounts need attention first.', 'Decide which accounts first.'); assert.deepEqual(r.missing, ['need', 'attention']); });
test('cut-off ending is detected as truncation', () => { const r = compareTranscript('Start the reminder workflow that fits the situation.', 'Start the reminder workflow that'); assert.equal(r.truncated, true); assert.equal(r.pass, false); });
test('extra words are reported and small differences tolerated', () => { const r = compareTranscript('Check the status whenever you need it.', 'Check the status whenever you need it now'); assert.deepEqual(r.extra, ['now']); assert.ok(r.pass); });
test('unrelated transcript fails', () => { assert.equal(compareTranscript('See Credit-IQ in action', 'thanks for watching').pass, false); });
