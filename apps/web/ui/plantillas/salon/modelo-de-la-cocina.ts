import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";

/**
 * El modelo de vista de la pantalla de la cocina (SAL-H; maqueta aprobada por el dueño el 25/11/2026, vía el orquestador): de lo que entrega el servidor (`cargarLaCocina`), lo que se ve y NADA más. Puro: sin React ni
 * servidor. Los textos salen del catálogo; no se arma ningún texto nuevo, solo se eligen los aprobados («Comandas» y «Envío N»; los estados e «Imprimir» son los del botón de imprimir).
 *
 * Reglas (cada una con su prueba en `test/web/salon-cocina-modelo.test.ts`):
 *  - **Solo lo pendiente o fallido.** El servidor ya trae únicamente los envíos de la sucursal de trabajo con el papel pendiente o fallido; un estado que esta pantalla no conoce (por ejemplo `IMPRESA`) no se muestra.
 *  - **Cada fila dice mesa, «Envío N» y la hora** (la hora la arma el servidor en la zona de la sucursal, no UTC).
 *  - **Un trabajo, un papel.** Lo pendiente es el trabajo que creó el envío (se imprime ESE); lo fallido va directo a «Reintentar» (el mismo trabajo con un intento más).
 *  - Sin un texto de «lista vacía» (`P-S5`): con nada pendiente la lista queda vacía, sin leyenda.
 */
export const RUTA_DE_LA_COCINA = "/salon/comandas";

/** Un envío como lo entrega la composición (la UI no importa los módulos). */
export type EnvioDeLaCocinaDeLaPantalla = Readonly<{
  trabajoId: string;
  envioId: string;
  rotulo: string;
  numero: number;
  hora: string;
  estado: string;
  intentos: number;
  sinImpresora: boolean;
}>;

type FilaDeLaCocina = Readonly<{
  /** El envío: es la clave de la fila y el documento que se imprime. */
  envioId: string;
  trabajoId: string;
  /** «Mesa 5». */
  titulo: string;
  /** «Envío 2 · 21:14». */
  detalle: string;
  /** `PENDIENTE`: se imprime el trabajo que creó el envío; `FALLIDA`: arranca en «No se pudo imprimir» con «Reintentar». */
  estado: "PENDIENTE" | "FALLIDA";
  intentos: number;
  sinImpresora: boolean;
}>;

export type CocinaArmada = Readonly<{
  /** El título de la pantalla («Comandas»). */
  titulo: string;
  filas: readonly FilaDeLaCocina[];
}>;

/** «Envío 2»: `comandas.texto.envio_envio_n` dice «Envío N» (la N final es el lugar del número; si una marca la redacta sin esa N, el número va al final). */
const envioN = (d: DiccionarioResuelto, numero: number): string => {
  const rotulo = texto(d, "comandas.texto.envio_envio_n");
  return rotulo.endsWith("N")
    ? `${rotulo.slice(0, -1)}${String(numero)}`
    : `${rotulo} ${String(numero)}`;
};

/** Arma la pantalla con los envíos que devolvió el servidor. El orden es el del servidor (los más nuevos primero). */
export function armarLaCocina(
  d: DiccionarioResuelto,
  envios: readonly EnvioDeLaCocinaDeLaPantalla[],
): CocinaArmada {
  return {
    titulo: texto(d, "comandas.texto.cocina_comandas"),
    filas: envios.flatMap((e) =>
      e.estado === "PENDIENTE" || e.estado === "FALLIDA"
        ? [
            {
              envioId: e.envioId,
              trabajoId: e.trabajoId,
              titulo: e.rotulo,
              detalle: `${envioN(d, e.numero)} · ${e.hora}`,
              estado: e.estado,
              intentos: e.intentos,
              sinImpresora: e.sinImpresora,
            },
          ]
        : [],
    ),
  };
}
