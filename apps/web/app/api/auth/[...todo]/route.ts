import { atenderIngreso } from "../../../../servidor/ingreso";

// Ingreso con Google y sesión (Better Auth, web-armazon §3.1 y §4). Solo se sirve en los hosts de una
// aplicación: en cualquier otro, el 404 neutro (G8). Todo método pasa por la misma puerta, así que lo que
// no está en la lista cerrada de rutas responde igual que lo desconocido (404) y no con un 405 que delate.

// `pg` y la librería necesitan Node, y la sesión no se cachea nunca.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = atenderIngreso;
export const POST = atenderIngreso;
export const PUT = atenderIngreso;
export const PATCH = atenderIngreso;
export const DELETE = atenderIngreso;
export const HEAD = atenderIngreso;
export const OPTIONS = atenderIngreso;
