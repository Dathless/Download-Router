import { expect, it } from 'vitest';
import {
  startFixtureServer,
  textFixture,
  pdfFixture,
  replacementFixture,
} from '../../scripts/fixture-server.mjs';
import pathCorpus from '../fixtures/path-corpus.json' with { type: 'json' };

it('TEST-DR-P0-02 fixture serves attachments and redirects without filesystem access', async () => {
  const fixture = await startFixtureServer(0);
  try {
    const response = await fetch(`${fixture.origin}/redirect`);
    expect(response.url).toBe(`${fixture.origin}/files/sample.txt`);
    expect(await response.text()).toBe(textFixture);
    const pdf = await fetch(`${fixture.origin}/download/123`);
    expect(pdf.headers.get('Content-Disposition')).toBe(
      'attachment; filename="report.pdf"',
    );
    expect(await pdf.text()).toBe(pdfFixture);
    expect((await fetch(`${fixture.origin}/unknown`)).status).toBe(404);
  } finally {
    await fixture.close();
  }
});

it('TEST-DR-P5-01/02 serves only fixed path cases and distinct conflict contents', async () => {
  const fixture = await startFixtureServer(0);
  try {
    for (const entry of pathCorpus.valid) {
      const response = await fetch(`${fixture.origin}/cases/${entry.id}`);
      expect(response.headers.get('Content-Disposition')).toBe(
        `attachment; filename*=UTF-8''${encodeURIComponent(entry.filename)}`,
      );
      expect(await response.text()).toBe(textFixture);
    }
    expect(await (await fetch(`${fixture.origin}/conflict/old`)).text()).toBe(
      textFixture,
    );
    expect(await (await fetch(`${fixture.origin}/conflict/new`)).text()).toBe(
      replacementFixture,
    );
    expect(
      (await fetch(`${fixture.origin}/cases/%2e%2e%2fsecret`)).status,
    ).toBe(404);
  } finally {
    await fixture.close();
  }
});

it('TEST-DR-P2-07 fixture provides distinct safe basenames for concurrent downloads', async () => {
  const fixture = await startFixtureServer(0);
  try {
    const response = await fetch(`${fixture.origin}/files/batch-1.txt`);
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="batch-1.txt"',
    );
    expect(await response.text()).toBe(textFixture);
    expect(
      (await fetch(`${fixture.origin}/files/not-allowed.html`)).status,
    ).toBe(404);
    expect((await fetch(`${fixture.origin}/files/%22unsafe.txt`)).status).toBe(
      404,
    );
  } finally {
    await fixture.close();
  }
});
