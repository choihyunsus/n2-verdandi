// Document ingestion exercises real common-memory writes, reasoning, provenance and failure recovery.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Verdandi } = require('../dist/library');
const { Mimir } = require('n2-mimir');
const { chunkDocument } = require('../dist/document-chunks');
const { fixture } = require('./helpers.cjs');
const { zip, pdf } = require('./document-fixtures.cjs');

function engine(f, agent = f.scope.agent) {
  return new Verdandi({ ...f.scope, agent, dbPath: f.dbPath, projectRoot: f.source });
}
function prose() {
  return [
    'Plant growth observations. '.repeat(65),
    'Watering records. '.repeat(95),
    'Garden measurements. '.repeat(80),
  ].join('\n\n');
}

test('document learning is owner-scoped, idempotent after restart and explicitly unverified', async () => {
  const f = await fixture();
  let client = engine(f);
  try {
    f.write('notes.txt', prose());
    const learned = await client.learn('notes.txt');
    assert.equal(learned.status, 'learned');
    assert.equal(learned.chunks, 3);
    assert.equal(learned.verified, false);
    assert.equal(learned.policyId, 'unfiltered-source-v1');
    for (const id of learned.sourceIds) {
      const source = f.store.memory.getExperience(id);
      assert.equal(source.type, 'pattern');
      assert.equal(source.project, f.scope.project);
      assert.equal(JSON.parse(source.context).source_hash, learned.hash);
      assert.match(source.sourceRef, /document:notes.txt/);
    }
    const insight = learned.insightIds[0];
    assert.equal(f.store.memory.reasoning.latestConclusion(insight).isVerified, false);
    f.store.connection.execute('UPDATE insights SET importance=5,effect_score=0.95 WHERE id=?', [
      insight,
    ]);
    const learner = new Mimir({ dbPath: f.dbPath });
    try {
      const digest = await learner.digest(f.scope);
      assert.equal(digest.graduated.includes(insight), false);
      assert.equal(f.store.memory.getInsight(insight).status, 'active');
    } finally {
      learner.close();
    }
    await client.close();
    client = engine(f);
    const repeated = await client.learn('notes.txt');
    assert.equal(repeated.status, 'already_learned');
    assert.deepEqual(repeated.sourceIds, learned.sourceIds);
    const other = engine(f, 'other');
    try {
      assert.equal((await other.learn('notes.txt')).status, 'learned');
    } finally {
      await other.close();
    }
    assert.equal(f.store.memory.getStats().experiences, 6);
  } finally {
    await client.close();
    f.close();
  }
});

test('concurrent same-document learning publishes one set and line endings normalize to one receipt', async () => {
  const f = await fixture(),
    first = engine(f),
    second = engine(f);
  try {
    f.write('notes.txt', prose());
    const results = await Promise.all([first.learn('notes.txt'), second.learn('notes.txt')]);
    assert.equal(results.filter((result) => result.status === 'learned').length, 1);
    assert.deepEqual(results[0].sourceIds, results[1].sourceIds);
    f.write('notes.txt', prose().replace(/\n/g, '\r\n'));
    const windows = await first.learn('notes.txt');
    assert.equal(windows.hash, results[0].hash);
    assert.equal(windows.status, 'already_learned');
    assert.equal(f.store.memory.getStats().experiences, 3);
  } finally {
    await first.close();
    await second.close();
    f.close();
  }
});

test('a changed source invalidates old evidence and a restored version creates fresh references', async () => {
  const f = await fixture(),
    client = engine(f);
  try {
    f.write('notes.txt', prose());
    const old = await client.learn('notes.txt');
    f.write('notes.txt', prose() + '\n\nAdditional observations.');
    const changed = await client.learn('notes.txt');
    assert.notEqual(changed.hash, old.hash);
    for (const id of old.sourceIds)
      assert.equal(
        f.store.connection.query(
          'SELECT * FROM mimir_evidence_invalidations WHERE experience_id=?',
          [id],
        ).length,
        1,
      );
    assert.equal(f.store.memory.getInsight(old.insightIds[0]).status, 'dormant');
    f.write('notes.txt', prose());
    const restored = await client.learn('notes.txt');
    assert.equal(restored.status, 'learned');
    assert.equal(restored.hash, old.hash);
    assert.notDeepEqual(restored.sourceIds, old.sourceIds);
    assert.equal((await client.learn('notes.txt')).status, 'already_learned');
    assert.equal(
      f.store.memory.getExperience(old.sourceIds[0]).outcome,
      prose().split('\n\n')[0].trim(),
    );
  } finally {
    await client.close();
    f.close();
  }
});

test('receipt insertion failures roll back experiences, insights, chains and evidence invalidation', async () => {
  const f = await fixture(),
    client = engine(f);
  try {
    f.write('notes.txt', prose());
    f.store.connection.execute(
      "CREATE TRIGGER test_doc_fail BEFORE INSERT ON verdandi_docs BEGIN SELECT RAISE(ABORT,'injected document failure'); END",
    );
    await assert.rejects(client.learn('notes.txt'), /injected document failure/);
    assert.equal(f.store.memory.getStats().experiences, 0);
    assert.equal(f.store.memory.getStats().insights, 0);
    assert.equal(f.store.connection.query('SELECT * FROM mimir_reasoning_atoms').length, 0);
    assert.equal(f.store.connection.query('SELECT * FROM verdandi_doc_receipts').length, 0);
    f.store.connection.execute('DROP TRIGGER test_doc_fail');
    const old = await client.learn('notes.txt');
    const before = f.store.memory.getStats();
    f.write('notes.txt', prose() + '\n\nChanged.');
    f.store.connection.execute(
      "CREATE TRIGGER test_doc_fail BEFORE INSERT ON verdandi_docs BEGIN SELECT RAISE(ABORT,'injected document failure'); END",
    );
    await assert.rejects(client.learn('notes.txt'), /injected document failure/);
    assert.deepEqual(f.store.memory.getStats(), before);
    assert.equal(f.store.connection.query('SELECT * FROM mimir_evidence_invalidations').length, 0);
    assert.equal(f.store.memory.getInsight(old.insightIds[0]).status, 'active');
  } finally {
    await client.close();
    f.close();
  }
});

test('screening is policy-versioned and all-rejected or failed screens leave storage untouched', async () => {
  const f = await fixture(),
    client = engine(f);
  try {
    f.write('notes.txt', prose());
    await assert.rejects(client.learn('notes.txt', { screen: () => true }), /policyId/);
    await assert.rejects(
      client.learn('notes.txt', { policyId: 'reject-v1', screen: () => false }),
      /All document chunks/,
    );
    await assert.rejects(
      client.learn('notes.txt', { policyId: 'invalid-v1', screen: () => 'yes' }),
      /boolean/,
    );
    assert.equal(f.store.memory.getStats().experiences, 0);
    const limited = await client.learn('notes.txt', {
      policyId: 'partial-v1',
      screen: (chunk) => chunk.index !== 1,
    });
    assert.equal(limited.chunks, 2);
    assert.equal(limited.rejectedChunks, 1);
    const next = await client.learn('notes.txt', {
      policyId: 'partial-v2',
      screen: (chunk) => chunk.index === 0,
    });
    assert.equal(next.chunks, 1);
    assert.equal(f.store.memory.getInsight(limited.insightIds[0]).status, 'dormant');
  } finally {
    await client.close();
    f.close();
  }
});

test('source changes during asynchronous screening cannot publish an obsolete receipt', async () => {
  const f = await fixture(),
    client = engine(f);
  try {
    f.write('notes.txt', prose());
    await assert.rejects(
      client.learn('notes.txt', {
        policyId: 'race-v1',
        screen: (chunk) => {
          if (chunk.index === 0) f.write('notes.txt', 'Updated while being screened.');
          return true;
        },
      }),
      /changed during learning/,
    );
    assert.equal(f.store.memory.getStats().experiences, 0);
  } finally {
    await client.close();
    f.close();
  }
});

test('closing cancels a screen that ignores its signal and waits before closing the database', async () => {
  const f = await fixture(),
    client = engine(f);
  try {
    f.write('notes.txt', prose());
    let started;
    const entered = new Promise((resolve) => {
      started = resolve;
    });
    const pending = client.learn('notes.txt', {
      policyId: 'pending-v1',
      screen: () => {
        started();
        return new Promise(() => {});
      },
    });
    const rejected = assert.rejects(pending, /closing/);
    await entered;
    await client.close();
    await rejected;
    assert.equal(f.store.memory.getStats().experiences, 0);
  } finally {
    await client.close();
    f.close();
  }
});

test('screen deadlines reject an uncooperative callback and preserve storage', async (t) => {
  const f = await fixture(),
    client = engine(f);
  const original = setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) =>
    original(callback, delay === 30000 ? 10 : delay, ...args),
  );
  try {
    f.write('notes.txt', prose());
    await assert.rejects(
      client.learn('notes.txt', { policyId: 'timeout-v1', screen: () => new Promise(() => {}) }),
      /exceeded 30 seconds/,
    );
    assert.equal(f.store.memory.getStats().experiences, 0);
  } finally {
    await client.close();
    f.close();
  }
});

test('more than 100 chunks retain every source through bounded unverified insight groups', async () => {
  const f = await fixture(),
    client = engine(f);
  try {
    f.write(
      'large.txt',
      Array.from(
        { length: 101 },
        (_, index) => `${index} ${'Source observations. '.repeat(80)}`,
      ).join('\n\n'),
    );
    const result = await client.learn('large.txt');
    assert.equal(result.chunks, 101);
    assert.equal(result.insightIds.length, 2);
    const linked = result.insightIds.flatMap((id) =>
      f.store.connection
        .query('SELECT experience_id FROM experience_insight_links WHERE insight_id=?', [id])
        .map((row) => row.experience_id),
    );
    assert.deepEqual(new Set(linked), new Set(result.sourceIds));
    assert.equal(
      result.insightIds.every((id) => !f.store.memory.reasoning.latestConclusion(id).isVerified),
      true,
    );
  } finally {
    await client.close();
    f.close();
  }
});

test('invalid sources, root changes and symlink escapes are rejected before learning', async () => {
  const f = await fixture(),
    client = engine(f);
  try {
    f.write('empty.txt', '  \n');
    f.write('invalid.txt', Buffer.from([255, 254]));
    f.write('oversize.txt', Buffer.alloc(10 * 1024 * 1024 + 1));
    await assert.rejects(client.learn('empty.txt'), /empty/);
    await assert.rejects(client.learn('invalid.txt'), /encoded data|encoding|UTF/i);
    await assert.rejects(client.learn('oversize.txt'), /limit|large|exceed/i);
    await assert.rejects(client.learn('../escape.txt'), /normalized components/);
    const outside = path.join(f.root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside fixture');
    fs.symlinkSync(
      outside,
      path.join(f.source, 'link'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await assert.rejects(client.learn('link/secret.txt'), /outside/);
    assert.throws(
      () => new Verdandi({ ...f.scope, dbPath: f.dbPath, projectRoot: outside }),
      /different source root/,
    );
    assert.equal(f.store.memory.getStats().experiences, 0);
  } finally {
    await client.close();
    f.close();
  }
});

test('heading and fence boundaries retain content and long Unicode paragraphs stay bounded', () => {
  const source =
    '# A\n' +
    'a'.repeat(1400) +
    '\n\n```md\n# inside a fence\n\ncode\n```\n\n# B\n' +
    'b'.repeat(1400);
  const chunks = chunkDocument(source);
  assert.equal(
    chunks.some((chunk) => chunk.includes('```md\n# inside a fence\n\ncode\n```')),
    true,
  );
  const long = '😀'.repeat(12000);
  const divided = chunkDocument(long);
  assert.equal(divided.join(''), long);
  assert.equal(
    divided.every((chunk) => chunk.length <= 8192 && !chunk.includes('\uFFFD')),
    true,
  );
  assert.deepEqual(chunkDocument(' \n '), []);
});

test('operation concurrency and invalid library options are bounded before work starts', async () => {
  const f = await fixture(),
    client = engine(f);
  try {
    await assert.rejects(client.build({ force: 'false' }), /boolean/);
    await assert.rejects(client.scan({ force: 'false' }), /boolean/);
    await assert.rejects(client.semantic({ force: 'false' }), /boolean/);
    assert.throws(() => client.backlinks('a.ts', { includeSemantic: 'false' }), /boolean/);
    f.write('pending.txt', 'Source fixture.');
    const pending = Array.from({ length: 8 }, () =>
      client.learn('pending.txt', {
        policyId: 'pending-v1',
        screen: () => new Promise(() => {}),
      }),
    );
    const settled = Promise.allSettled(pending);
    await assert.rejects(client.learn('pending.txt'), /Eight operations/);
    await client.close();
    assert.equal(
      (await settled).every((result) => result.status === 'rejected'),
      true,
    );
    assert.equal(f.store.memory.getStats().experiences, 0);
  } finally {
    await client.close();
    f.close();
  }
});

test('PDF, DOCX, XLSX and PPTX use the actual guarded Arachne parser through the public learning entry', async () => {
  const f = await fixture(),
    client = engine(f);
  try {
    f.write('one.pdf', pdf('PDF learning fixture', true));
    f.write(
      'two.docx',
      zip([
        [
          'word/document.xml',
          '<w:document xmlns:w="w"><w:p><w:t>한글 문서 학습</w:t></w:p></w:document>',
        ],
      ]),
    );
    f.write(
      'three.xlsx',
      zip([
        [
          'xl/sharedStrings.xml',
          '<sst><si><t>사용한 셀</t></si><si><t>unused fixture</t></si></sst>',
        ],
        [
          'xl/worksheets/sheet1.xml',
          '<worksheet><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42.5</v></c></worksheet>',
        ],
      ]),
    );
    f.write(
      'four.pptx',
      zip([
        ['ppt/slides/slide2.xml', '<s><t>Second slide</t></s>'],
        ['ppt/slides/slide1.xml', '<s><t>First slide</t></s>'],
      ]),
    );
    const expected = [
      ['one.pdf', /PDF learning fixture/],
      ['two.docx', /한글 문서 학습/],
      ['three.xlsx', /사용한 셀/],
      ['four.pptx', /First slide[\s\S]*Second slide/],
    ];
    for (const [filename, pattern] of expected) {
      const result = await client.learn(filename);
      const content = result.sourceIds
        .map((id) => f.store.memory.getExperience(id).outcome)
        .join('\n');
      assert.match(content, pattern);
      assert.doesNotMatch(content, /unused fixture/);
      assert.equal((await client.learn(filename)).status, 'already_learned');
    }
    const before = f.store.memory.getStats();
    f.write('bad.docx', 'broken fixture');
    await assert.rejects(client.learn('bad.docx'), /parser|ZIP|document/i);
    assert.deepEqual(f.store.memory.getStats(), before);
  } finally {
    await client.close();
    f.close();
  }
});

test('receipt references cannot cross owners and edited memory content requires fresh learning', async () => {
  const f = await fixture(),
    client = engine(f),
    other = engine(f, 'other');
  try {
    f.write('notes.txt', 'Fixture source content.');
    const own = await client.learn('notes.txt'),
      foreign = await other.learn('notes.txt');
    f.store.connection.execute('UPDATE verdandi_doc_receipts SET source_ids_json=? WHERE agent=?', [
      JSON.stringify(foreign.sourceIds),
      f.scope.agent,
    ]);
    await assert.rejects(client.learn('notes.txt'), /memory owner/);
    assert.equal(f.store.connection.query('SELECT * FROM mimir_evidence_invalidations').length, 0);
    f.store.connection.execute(
      'UPDATE verdandi_doc_receipts SET source_ids_json=?,insight_ids_json=? WHERE agent=?',
      [JSON.stringify(own.sourceIds), JSON.stringify(foreign.insightIds), f.scope.agent],
    );
    await assert.rejects(client.learn('notes.txt'), /memory owner/);
    f.store.connection.execute(
      'UPDATE verdandi_doc_receipts SET insight_ids_json=? WHERE agent=?',
      [JSON.stringify(own.insightIds), f.scope.agent],
    );
    f.store.connection.execute("UPDATE experiences SET outcome='Changed memory text' WHERE id=?", [
      own.sourceIds[0],
    ]);
    const repaired = await client.learn('notes.txt');
    assert.equal(repaired.status, 'learned');
    assert.notDeepEqual(repaired.sourceIds, own.sourceIds);
    assert.equal(
      f.store.memory.getExperience(repaired.sourceIds[0]).outcome,
      'Fixture source content.',
    );
  } finally {
    await client.close();
    await other.close();
    f.close();
  }
});
