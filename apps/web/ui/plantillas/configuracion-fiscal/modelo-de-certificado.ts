import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { formatearFecha, formatearNumeroDeDocumento } from "../facturacion/formato-fiscal";
import { cartelDeUnCertificado, conCartel, RUTAS_DE_CONFIGURACION } from "./lista-de-lo-que-falta";

/**
 * El modelo de vista de la pantalla «Certificado de ARCA» (opción B: asistente de 3 pasos por ambiente; dueño, 2026-11-03, cuestionario
 * «Certificado»). Puro: sin React ni servidor. De lo que entrega `estadoDeCertificados` (ya con el vencimiento convertido a fecha civil
 * argentina por la página): qué lista, qué detalle y desde qué paso arranca cada ambiente, y cómo se arman los dos pedidos al servidor.
 * Previene: un cartel o un paso que no es del estado del ambiente, y un pedido de certificado con un campo que el servidor no lee.
 * Chequeo: `test/web/certificado-de-arca-modelo.test.ts`.
 */

export type AmbienteDeCertificado = "HOMOLOGACION" | "PRODUCCION";

/** Lo que la pantalla lee del estado de un ambiente (la misma forma que entrega la composición, sin importarla). `vence`: `AAAA-MM-DD`. */
export type CertificadoParaMostrar =
  | Readonly<{ ambiente: AmbienteDeCertificado; situacion: "FALTA_CARGAR" }>
  | Readonly<{
      ambiente: AmbienteDeCertificado;
      situacion: "PEDIDO_GENERADO";
      certificadoId: string;
      alias: string;
      cuitTitular: string;
    }>
  | Readonly<{
      ambiente: AmbienteDeCertificado;
      situacion: "VIGENTE";
      alias: string;
      cuitTitular: string;
      vence: string;
      vencido: boolean;
      /** La renovación en curso (D-94): el último pedido sin certificado, aunque ya haya uno vigente. */
      pedidoPendiente: PedidoPendienteParaMostrar | null;
    }>;

/** El pedido pendiente que informa el estado: lo que hace falta para cargar su certificado y para reconocerlo. */
export type PedidoPendienteParaMostrar = Readonly<{
  certificadoId: string;
  alias: string;
  cuitTitular: string;
}>;

/**
 * SUPUESTO (DEC-0050) del ingeniero (el prototipo B lo muestra así): Pruebas primero, Producción segundo. Sin cuestionario que lo nombre.
 * Revertirlo es invertir esta lista.
 */
const AMBIENTES_EN_ORDEN: readonly AmbienteDeCertificado[] = ["HOMOLOGACION", "PRODUCCION"];

/** El ambiente en la dirección de la página (una sola regla: la usan la lista, la página del ambiente y sus pruebas). */
const SEGMENTO: Readonly<Record<AmbienteDeCertificado, string>> = {
  HOMOLOGACION: "pruebas",
  PRODUCCION: "produccion",
};

export const rutaDelCertificadoDe = (ambiente: AmbienteDeCertificado): string =>
  `${RUTAS_DE_CONFIGURACION.certificado}/${SEGMENTO[ambiente]}`;

/** `null`: un segmento que no es un ambiente (la página dice «no encontrado»). */
export const ambienteDelSegmento = (segmento: string): AmbienteDeCertificado | null =>
  AMBIENTES_EN_ORDEN.find((a) => SEGMENTO[a] === segmento) ?? null;

export const nombreDelAmbiente = (ambiente: AmbienteDeCertificado): string =>
  texto(
    {},
    ambiente === "PRODUCCION"
      ? "fiscal.pantalla.config_pv_produccion"
      : "fiscal.pantalla.config_pv_pruebas",
  );

export type FilaDeAmbiente = Readonly<{
  ambiente: AmbienteDeCertificado;
  titulo: string;
  href: string;
  /** «Vence 12/10/2028»; solo con certificado vigente (Dueño, 2026-11-03: solo la fecha, sin días que faltan ni «por vencer»). */
  vence: string | null;
  cartel: ReturnType<typeof conCartel>;
}>;

const porAmbiente = (
  certificados: readonly CertificadoParaMostrar[],
  ambiente: AmbienteDeCertificado,
) => certificados.find((c) => c.ambiente === ambiente);

const textoDeVence = (vence: string): string =>
  `${texto({}, "fiscal.pantalla.config_cert_vence")} ${formatearFecha(vence)}`;

/** Una fila por ambiente, Pruebas primero. Un ambiente que el estado no trae se dice como «Falta cargar» (cierra por el lado seguro). */
export function armarLaListaDeAmbientes(
  certificados: readonly CertificadoParaMostrar[],
): readonly FilaDeAmbiente[] {
  return AMBIENTES_EN_ORDEN.map((ambiente) => {
    const c = porAmbiente(certificados, ambiente) ?? {
      ambiente,
      situacion: "FALTA_CARGAR" as const,
    };
    return {
      ambiente,
      titulo: nombreDelAmbiente(ambiente),
      href: rutaDelCertificadoDe(ambiente),
      vence: c.situacion === "VIGENTE" ? textoDeVence(c.vence) : null,
      cartel: conCartel(
        cartelDeUnCertificado({ ...c, vencido: c.situacion === "VIGENTE" && c.vencido }),
      ),
    };
  });
}

type DatoParaLeer = Readonly<{ rotulo: string; valor: string }>;

/** Desde dónde arranca la pantalla de un ambiente. */
export type ArranqueDelAmbiente =
  /** Falta cargar: el paso 1. */
  | Readonly<{ vista: "generar"; aliasInicial: string }>
  /** Pedido generado: el paso 3 (el pedido no se vuelve a ver). */
  | Readonly<{ vista: "cargar"; certificadoId: string; datos: readonly DatoParaLeer[] }>
  /** Vigente: el detalle, con «Reemplazar» y, si hay una renovación en curso (D-94), «Cargar certificado» contra ese pedido. */
  | Readonly<{
      vista: "detalle";
      aliasInicial: string;
      datos: readonly DatoParaLeer[];
      cartel: ReturnType<typeof conCartel>;
      pedidoPendiente: PedidoParaCargar | null;
    }>;

/** El pedido contra el que se carga el certificado, con los datos que se leen en el paso 3. */
type PedidoParaCargar = Readonly<{ certificadoId: string; datos: readonly DatoParaLeer[] }>;

const dato = (clave: "alias" | "titular" | "vence", valor: string): DatoParaLeer => ({
  rotulo: texto(
    {},
    clave === "alias"
      ? "fiscal.pantalla.config_cert_alias"
      : clave === "titular"
        ? "fiscal.pantalla.config_cert_titular"
        : "fiscal.pantalla.config_cert_vence",
  ),
  valor,
});

const cuit = (numero: string): string => formatearNumeroDeDocumento("CUIT", numero);

const pedidoParaCargar = (p: PedidoPendienteParaMostrar): PedidoParaCargar => ({
  certificadoId: p.certificadoId,
  datos: [dato("alias", p.alias), dato("titular", cuit(p.cuitTitular))],
});

export function armarElAmbiente(c: CertificadoParaMostrar): ArranqueDelAmbiente {
  switch (c.situacion) {
    case "FALTA_CARGAR":
      return { vista: "generar", aliasInicial: "" };
    case "PEDIDO_GENERADO":
      return { vista: "cargar", ...pedidoParaCargar(c) };
    case "VIGENTE":
      return {
        vista: "detalle",
        // Dueño, 2026-11-03, cuestionario «Reemplazar»: el paso 1 de un reemplazo viene con el alias del certificado actual (ARCA exige
        // el mismo alias para renovar; manual «Generación de Certificados para Producción», «Solicitud del Certificado Digital»).
        aliasInicial: c.alias,
        datos: [
          dato("alias", c.alias),
          dato("titular", cuit(c.cuitTitular)),
          dato("vence", formatearFecha(c.vence)),
        ],
        cartel: conCartel(cartelDeUnCertificado({ ...c, vencido: c.vencido })),
        pedidoPendiente: c.pedidoPendiente === null ? null : pedidoParaCargar(c.pedidoPendiente),
      };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Los dos pedidos al servidor.

export type ValoresDelPedido = Readonly<{
  alias: string;
  cuitTitular: string;
  organizacion: string;
}>;

/** Los datos del pedido, tal como los escribió la persona: si son válidos lo decide el servidor. `id`: la clave de idempotencia. */
export const armarElPedidoDeCertificado = (
  valores: ValoresDelPedido,
  id: string,
  emisorId: string,
  ambiente: AmbienteDeCertificado,
) => ({
  id,
  emisorId,
  ambiente,
  alias: valores.alias,
  cuitTitular: valores.cuitTitular,
  organizacion: valores.organizacion,
});

export const armarLaCargaDeCertificado = (certificadoId: string, certificadoPem: string) => ({
  certificadoId,
  certificadoPem,
});

export type CampoDelPedido = "alias" | "cuitTitular" | "organizacion";
export type CampoDeLaCarga = "certificadoPem";

const esDe = <C extends string>(campos: readonly C[], campo: string | undefined): C | null =>
  campos.find((c) => c === campo) ?? null;

/** El nombre de campo del servidor (`campo` del error) → dónde lo marca el paso 1. Uno que no conoce: `null`. */
export const lugarDelErrorDelPedido = (campo: string | undefined): CampoDelPedido | null =>
  esDe(["alias", "cuitTitular", "organizacion"], campo);

export const lugarDelErrorDeLaCarga = (campo: string | undefined): CampoDeLaCarga | null =>
  esDe(["certificadoPem"], campo);

/** El nombre del archivo del pedido que se descarga: el alias (solo letras y dígitos) y `.csr`. SUPUESTO (DEC-0050) del ingeniero: ningún texto lo nombra. */
export const nombreDelArchivoDelPedido = (alias: string): string =>
  `${alias.replace(/[^A-Za-z0-9]/g, "") || "pedido"}.csr`;
