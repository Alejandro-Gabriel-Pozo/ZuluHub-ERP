import { atenderIngreso } from "../../../../servidor/ingreso";

// Ingreso de la consola (Google y segundo factor). Todo método pasa por la misma puerta, así que lo que no está en
// la lista cerrada de rutas responde igual que lo desconocido (404) y no con un 405 que delate.

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
