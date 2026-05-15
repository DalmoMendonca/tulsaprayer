import prayerService from "../../lib/prayer-service.js";

const { listPrayers, createPrayer, clearArea, deletePrayer, getAudio, transcribe } = prayerService;

export default async (request) => {
  try {
    const url = new URL(request.url);
    const audioMatch = url.pathname.match(/^\/api\/prayers\/audio\/([a-f0-9-]+)$/i);
    if (request.method === "GET" && audioMatch) {
      const audio = await getAudio(audioMatch[1]);
      return new Response(audio.data, {
        headers: {
          "Content-Type": audio.contentType,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    if (request.method === "GET") {
      return json(await listPrayers());
    }

    const body = await parseBody(request);

    if (request.method === "POST" && url.pathname === "/api/transcribe") {
      return json(await transcribe(body));
    }

    if (request.method === "POST") {
      return json(await createPrayer(body));
    }

    if (request.method === "DELETE") {
      if (body.prayerId) return json(await deletePrayer(body.areaId, body.prayerId, body.password));
      return json(await clearArea(body.areaId, body.password));
    }

    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    return json({ error: error.message || "Server error." }, error.status || 500);
  }
};

export const config = {
  path: ["/api/prayers", "/api/prayers/audio/:id", "/api/transcribe"],
};

async function parseBody(request) {
  const text = await request.text();
  return text ? JSON.parse(text) : {};
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
