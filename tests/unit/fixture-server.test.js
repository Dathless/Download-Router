import { expect, it } from 'vitest';
import {
  startFixtureServer,
  textFixture,
  pdfFixture,
} from '../../scripts/fixture-server.mjs';

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
