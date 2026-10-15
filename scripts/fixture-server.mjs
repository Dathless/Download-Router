import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import pathCorpus from '../tests/fixtures/path-corpus.json' with { type: 'json' };

export const textFixture = 'Download Router Phase 0 fixture\n';
export const pdfFixture =
  '%PDF-1.4\n% Download Router Phase 0 fixture\n%%EOF\n';
export const replacementFixture =
  'Download Router Phase 5 replacement fixture\n';

export async function startFixtureServer(port = 8173) {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const textName = /^\/files\/([a-z0-9-]+\.txt)$/u.exec(pathname)?.[1];
    const pathCase = pathCorpus.valid.find(
      (entry) => pathname === `/cases/${entry.id}`,
    );
    if (pathname === '/redirect') {
      response.writeHead(302, { Location: '/files/sample.txt' }).end();
    } else if (
      pathCase ||
      pathname === '/conflict/old' ||
      pathname === '/conflict/new'
    ) {
      const filename = pathCase?.filename ?? 'conflict.txt';
      response
        .writeHead(200, {
          'Content-Type': 'text/plain',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
          'Cache-Control': 'no-store',
        })
        .end(pathname === '/conflict/new' ? replacementFixture : textFixture);
    } else if (textName || pathname === '/download/123') {
      const pdf = pathname === '/download/123';
      response
        .writeHead(200, {
          'Content-Type': pdf ? 'application/pdf' : 'text/plain',
          'Content-Disposition': `attachment; filename="${pdf ? 'report.pdf' : textName}"`,
          'Cache-Control': 'no-store',
        })
        .end(pdf ? pdfFixture : textFixture);
    } else if (pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(`<!doctype html>
        <html lang="en"><title>Download Router fixtures</title>
        <h1>Download Router fixtures</h1>
        <a id="direct" href="/files/sample.txt">Direct attachment</a>
        <a id="redirect" href="/redirect">Redirect attachment</a>
        <a id="pdf" href="/download/123">Content-Disposition PDF</a></html>`);
    } else {
      response.writeHead(404).end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const fixture = await startFixtureServer();
  console.log(`Fixture server: ${fixture.origin} (Ctrl+C to stop)`);
  process.once('SIGINT', () => void fixture.close());
  process.once('SIGTERM', () => void fixture.close());
}
