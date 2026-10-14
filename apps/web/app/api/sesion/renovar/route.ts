import { atenderRenovacion } from "../../../../servidor/renovar-sesion";

// El «Seguir» del aviso de sesión: renueva la sesión y devuelve la cookie renovada. Solo `POST` (cualquier
// otro método lo rechaza Next) y solo en un host de aplicación; la sesión no se cachea nunca.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = atenderRenovacion;
