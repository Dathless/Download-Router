import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

export const textFixture = 'Download Router Phase 0 fixture\n';
export const pdfFixture =
  '%PDF-1.4\n% Download Router Phase 0 fixture\n%%EOF\n';

export async function startFixtureServer(port = 8173) {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (pathname === '/redirect') {
      response.writeHead(302, { Location: '/files/sample.txt' }).end();
    } else if (
      pathname === '/files/sample.txt' ||
      pathname === '/download/123'
    ) {
      const pdf = pathname === '/download/123';
      response
        .writeHead(200, {
          'Content-Type': pdf ? 'application/pdf' : 'text/plain',
          'Content-Disposition': `attachment; filename="${pdf ? 'report.pdf' : 'sample.txt'}"`,
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
