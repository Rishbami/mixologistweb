const ALLOWED_HOSTS = new Set([
  "www.thecocktaildb.com",
  "thecocktaildb.com",
]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get("url");

  if (!imageUrl) {
    return Response.json({ error: "Missing url query parameter." }, { status: 400 });
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(imageUrl);
  } catch {
    return Response.json({ error: "Invalid image url." }, { status: 400 });
  }

  if (!ALLOWED_HOSTS.has(parsedUrl.hostname)) {
    return Response.json({ error: "Unsupported image host." }, { status: 400 });
  }

  try {
    const upstreamResponse = await fetch(parsedUrl, { cache: "no-store" });

    if (!upstreamResponse.ok) {
      return Response.json(
        { error: `Image fetch failed with status ${upstreamResponse.status}.` },
        { status: upstreamResponse.status },
      );
    }

    const contentType = upstreamResponse.headers.get("content-type") ?? "image/jpeg";
    const arrayBuffer = await upstreamResponse.arrayBuffer();

    return new Response(arrayBuffer, {
      headers: {
        "cache-control": "no-store",
        "content-type": contentType,
      },
    });
  } catch {
    return Response.json({ error: "Unable to fetch remote image." }, { status: 500 });
  }
}
