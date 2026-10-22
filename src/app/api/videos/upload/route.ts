import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!/^videos\/[a-z0-9-]+\.(webm|mp4)$/.test(pathname)) throw new Error("Unexpected upload path");
        return {
          allowedContentTypes: ["video/webm", "video/mp4"],
          maximumSizeInBytes: 200_000_000,
          addRandomSuffix: true,
        };
      },
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
