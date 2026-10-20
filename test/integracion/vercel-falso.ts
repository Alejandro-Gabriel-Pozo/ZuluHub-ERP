/**
 * Un Vercel falso para probar `migrar-base --vercel` sin red: un `fetch` con estado propio que
 * entiende solo las cuatro rutas que usa el comando (listar, crear con `upsert`, borrar y modificar
 * una variable del proyecto `pedernal-erp`) y anota cada pedido. Es MÁS ESTRICTO que lo que se sabe de
 * Vercel a propósito: una variable con el mismo nombre y un destino que se pisa sin ser idéntico es un
 * conflicto (409) aunque haya `upsert`, así que el comando tiene que liberarla antes de escribir.
 */

export const TOKEN_FALSO = "vcp_TokenFalsoDeLasPruebas0123";
export const PROYECTO = "prj_BZ5e86RcBcfYCAzSW2vVbPpkj7jG";

export type VariableFalsa = {
  id: string;
  key: string;
  type: string;
  target: string[];
  valor: string;
  gitBranch?: string | null;
  customEnvironmentIds?: string[];
};

type PedidoAnotado = {
  metodo: string;
  ruta: string;
  consulta: Record<string, string>;
  encabezados: Record<string, string>;
  cuerpo: unknown;
};

export type Interceptor = (
  pedido: PedidoAnotado,
  numero: number,
) => Response | Error | Promise<Response | Error | undefined> | undefined;

export function crearVercelFalso(
  iniciales: Omit<VariableFalsa, "id">[] = [],
  interceptor: Interceptor | null = null,
) {
  let proximoId = 1;
  const variables = new Map<string, VariableFalsa>();
  const agregar = (v: Omit<VariableFalsa, "id">) => {
    const id = `env_${proximoId++}`;
    variables.set(id, { ...v, id });
    return id;
  };
  for (const inicial of iniciales) agregar(inicial);
  const pedidos: PedidoAnotado[] = [];

  const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status });
  const error = (status: number, code: string, message = "") =>
    json({ error: { code, message } }, status);
  const sinValor = (v: VariableFalsa) => ({
    id: v.id,
    key: v.key,
    type: v.type,
    target: v.target,
    gitBranch: v.gitBranch ?? null,
    customEnvironmentIds: v.customEnvironmentIds ?? [],
  });

  async function atender(url: URL, init: RequestInit): Promise<Response> {
    const encabezados = (init.headers ?? {}) as Record<string, string>;
    const pedido: PedidoAnotado = {
      metodo: init.method ?? "GET",
      ruta: url.pathname,
      consulta: Object.fromEntries(url.searchParams),
      encabezados: { ...encabezados },
      cuerpo: init.body === undefined ? undefined : JSON.parse(init.body as string),
    };
    pedidos.push(pedido);
    const desviado = await interceptor?.(pedido, pedidos.length);
    if (desviado instanceof Error) throw desviado;
    if (desviado !== undefined) return desviado;

    if (encabezados["Authorization"] !== `Bearer ${TOKEN_FALSO}`) return error(401, "forbidden");
    if (pedido.consulta["slug"] !== "alepozod") return error(403, "forbidden");
    const base = `/projects/${PROYECTO}/env`;
    const m = /^\/v(\d+)(\/projects\/[^/]+\/env)(?:\/([^/]+))?$/.exec(pedido.ruta);
    if (m === null || m[2] !== base) return error(404, "not_found");
    const id = m[3] === undefined ? undefined : decodeURIComponent(m[3]);

    if (pedido.metodo === "GET" && id === undefined) {
      return json({ envs: [...variables.values()].map(sinValor) });
    }
    if (pedido.metodo === "POST" && id === undefined) {
      const c = pedido.cuerpo as { key: string; value: string; type: string; target: string[] };
      for (const existente of variables.values()) {
        if (existente.key !== c.key) continue;
        const mismoDestino =
          existente.target.length === c.target.length &&
          existente.target.every((t) => c.target.includes(t));
        const seSuperponen = existente.target.some((t) => c.target.includes(t));
        if (mismoDestino && existente.type === "sensitive") {
          if (pedido.consulta["upsert"] !== "true") return error(409, "ENV_CONFLICT");
          existente.valor = c.value;
          return json({ created: sinValor(existente), failed: [] });
        }
        if (seSuperponen) return error(409, "ENV_CONFLICT", "la variable ya existe");
      }
      const nuevo = agregar({ key: c.key, type: c.type, target: c.target, valor: c.value });
      return json({ created: sinValor(variables.get(nuevo) as VariableFalsa), failed: [] });
    }
    if (pedido.metodo === "DELETE" && id !== undefined) {
      return variables.delete(id) ? json({ id }) : error(404, "not_found");
    }
    if (pedido.metodo === "PATCH" && id !== undefined) {
      const existente = variables.get(id);
      if (existente === undefined) return error(404, "not_found");
      existente.target = (pedido.cuerpo as { target: string[] }).target;
      return json(sinValor(existente));
    }
    return error(405, "method_not_allowed");
  }

  return {
    pedidos,
    variables,
    fetch: ((url: string, init?: RequestInit) =>
      atender(new URL(url), init ?? {})) as unknown as typeof fetch,
    /** Las variables de un nombre, para ver duplicados. */
    de: (key: string) => [...variables.values()].filter((v) => v.key === key),
    /** Una foto de lo que hay (para comprobar que algo no se tocó). */
    foto: () => JSON.stringify([...variables.values()]),
    /** Los pedidos que cambian algo. */
    escrituras: () => pedidos.filter((p) => p.metodo !== "GET"),
  };
}
