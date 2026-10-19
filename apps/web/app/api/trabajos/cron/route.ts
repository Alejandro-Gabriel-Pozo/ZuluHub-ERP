import { atenderElCron } from "../../../../servidor/rutas-de-sistema";

// El cron de Vercel (una vez por día mientras sea Hobby, `vercel.json`). Autorizado con `CRON_SECRET`: sin él,
// 401 sin cuerpo. Despacha la cola de trabajos y barre lo vencido de la autenticación (ADR-007, web-armazon §5.5).
// Solo GET (es lo que manda Vercel); cualquier otro método lo rechaza Next con 405 y sin ejecutar nada.

// `pg` necesita Node, y esto no se cachea nunca ni se genera al compilar.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Tope de duración de la función (en segundos): un lote de envíos puede tardar más que el de defecto de un
// plan chico. 60 entra en el máximo de Hobby; si el plan lo rechaza, se baja (a verificar en el primer despliegue).
export const maxDuration = 60;

export const GET = atenderElCron;
