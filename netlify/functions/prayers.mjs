import prayerService from "../../lib/prayer-service.js";

const { listPrayers, createPrayer, clearArea } = prayerService;

export default async (request) => {
  try {
    if (request.method === "GET") {
      return json(await listPrayers());
    }

    const body = await parseBody(request);

    if (request.method === "POST") {
      return json(await createPrayer(body));
    }

    if (request.method === "DELETE") {
      return json(await clearArea(body.areaId, body.password));
    }

    return json({ error: "Method not allowed." }, 405);
  } catch (error) {
    return json({ error: error.message || "Server error." }, error.status || 500);
  }
};

export const config = {
  path: "/api/prayers",
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
