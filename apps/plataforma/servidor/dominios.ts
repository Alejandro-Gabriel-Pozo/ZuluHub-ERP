import "server-only";

import { PERMISOS_DE_PLATAFORMA } from "../../../src/capacidades/permisos/plataforma";
import { LIMITE_MAXIMO_DE_PAGINA } from "../../../src/plataforma/dominio/soporte/consulta";
import {
  SUPERFICIES_DE_ALTA,
  type DominioParaLaPantalla,
  type EmpresaParaElSelector,
  type SuperficieDeAlta,
} from "../logica/cambio-de-dominio";
import { exigirAcceso } from "./acceso";
import { fallaDe, protegida, type Falla } from "./proteccion";

export type { Falla } from "./proteccion";

const ETIQUETA = "dominios";

export type ResultadoDeDominios =
  | Readonly<{
      ok: true;
      dominios: readonly DominioParaLaPantalla[];
      empresas: readonly EmpresaParaElSelector[];
      /** Si quien mira puede cambiar dominios. Solo una ayuda para no ofrecer los botones: el guard y el segundo factor deciden al enviar. */
      puedeEditar: boolean;
    }>
  | Falla;

const ZONA_DE_LA_FECHA = "America/Argentina/Buenos_Aires";
const formatoDeFecha = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_DE_LA_FECHA,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** Un dominio de empresa solo puede ser de la aplicación o de la carta (CHECK `dominio_superficie_duenio_ck`); otra cosa es un dato roto y no se muestra a medias. */
function superficieDeEmpresa(superficie: string): SuperficieDeAlta {
  const encontrada = SUPERFICIES_DE_ALTA.find((s) => s === superficie);
  if (encontrada === undefined)
    throw new RangeError(`superficie inesperada en un dominio de empresa: ${superficie}`);
  return encontrada;
}

/** `dd/mm/aaaa` en la Argentina (no depende de la zona del servidor). */
export const fechaDeVerificacion = (fecha: Date): string => formatoDeFecha.format(fecha);

/**
 * Los dominios de las empresas y las empresas para elegir al dar uno de alta (`dominios.ver` y `empresas.ver`: ADMIN y SOPORTE). Una sola página de cada una
 * (hasta `LIMITE_MAXIMO_DE_PAGINA`): suficiente mientras haya pocos dominios; con más hay que paginar.
 */
export async function dominiosDeLasEmpresas(): Promise<ResultadoDeDominios> {
  return protegida(ETIQUETA, async () => {
    const acceso = await exigirAcceso();
    const [dominios, empresas] = await Promise.all([
      acceso.consultas.listarDominios({ limite: LIMITE_MAXIMO_DE_PAGINA }),
      acceso.consultas.listarEmpresas({ limite: LIMITE_MAXIMO_DE_PAGINA }),
    ]);
    if (!dominios.ok) return fallaDe(ETIQUETA, dominios.error);
    if (!empresas.ok) return fallaDe(ETIQUETA, empresas.error);
    return {
      ok: true as const,
      dominios: dominios.valor.filas.map((d): DominioParaLaPantalla => ({
        id: d.id,
        host: d.host,
        superficie: superficieDeEmpresa(d.superficie),
        titular: d.titular,
        estado: d.estado,
        verificadoEn: d.verificadoEn === null ? null : fechaDeVerificacion(d.verificadoEn),
        motivo: d.motivo,
        empresa: d.razonSocial,
      })),
      empresas: empresas.valor.filas.map((e) => ({ id: e.id, razonSocial: e.razonSocial })),
      puedeEditar: PERMISOS_DE_PLATAFORMA["dominios.agregar"].some(
        (rol) => rol === acceso.admin.rol,
      ),
    };
  });
}
