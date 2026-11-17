import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import type { Cantidad } from "../../../primitivas/cantidad/cantidad";
import type { Importe } from "../../../primitivas/dinero/importe";
import type { PrecioUnitario } from "../../../primitivas/dinero/precio-unitario";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { err, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  TIPOS_DE_ORIGEN_DE_FACTURA_DE_ORIGEN,
  type TipoDeOrigenDeFacturaDeOrigen,
} from "../dominio/comprobante-emitido";
import type { CodigoDeAlicuota } from "../dominio/alicuota";
import { comprobanteId, esUuid, origenId, type PuntoDeVentaId } from "../dominio/identificadores";
import type { Receptor } from "../dominio/receptor";
import { traducirErroresDeFiscal } from "../persistencia/traducir";
import type { DependenciasDeFacturacion, TxDeFacturacion } from "./contrato-de-facturacion";
import { DECLARACIONES_DE_FACTURACION } from "./declaraciones-de-facturacion";
import {
  ADMITIDOS_AL_EMITIR,
  emitirEnTx,
  huellaDeLaFacturaDeOrigen,
  type EntradaDeComprobanteManual,
  type ErrorDeOrigen,
  type ErrorPropioAlEmitir,
  type SalidaDeEmitir,
} from "./emitir-comprobante";

/**
 * Facturar un documento que armó otro módulo (E1; decisiones 148, 149, 150 y 175): la factura de un documento ya cobrado, con sus renglones
 * congelados; solo se elige el receptor. Fiscal NO conoce de dónde viene: recibe un origen opaco (`origen.tipo` de una lista de permitidos y su
 * `id`) y renglones como datos. Quien llama (ventas, por la composición, que es el único lugar donde se tocan los dos módulos) la corre DENTRO
 * de su propia transacción: el comprobante, su trabajo de validación, su auditoría y lo que quien llama guarde del vínculo son todo o nada.
 *
 * Es el cuerpo de `emitirComprobanteManual` (`emitirEnTx`) con el origen como dato, y fijos por contrato, no por parámetro: la clase es FACTURA,
 * el concepto PRODUCTOS, sin período de servicio, el precio lleva el IVA incluido (D-85) y sin descuento. Antes de escribir:
 *  1. Guard (`comprobantes.emitir`, COMPLETA_CIERRA: completa algo ya vendido y se puede aunque el plan haya bajado; la factura libre sigue con
 *     `comprobantes.emitir_manual`). Fiscal lo vuelve a verificar aunque quien llama ya lo haya hecho: un caso de uso no confía en quien lo llama.
 *  2. El origen es de la lista de permitidos y los dos ids (el del origen y el del comprobante) son un uuid.
 *  3. Repetición por origen: la misma huella da `yaExistia` sin escribir; otra, `CLAVE_REUTILIZADA`. Una factura autorizada y acreditada sigue
 *     «vigente» para su origen: reemitir exige otro origen (el de la reemisión, D-F-2), que elige quien llama con `vigenciaDeComprobantes`.
 *  4. El punto de venta es de la sucursal esperada (`PUNTO_DE_VENTA_DE_OTRA_SUCURSAL`) y lo demás de la emisión manual (alcance, sucursal abierta,
 *     emisor, datos fiscales con Ingresos Brutos y certificado vigente).
 *  5. Con letra C se descarta la alícuota de los renglones; el total calculado tiene que ser el esperado (`TOTAL_NO_COINCIDE`).
 * Todas las validaciones corren antes de escribir: un error devuelto no deja escrituras. El `id` del comprobante lo elige quien llama y tiene que ser
 * estable entre reintentos (una repetición lo encuentra por su origen, no por el id).
 */

/** Un renglón del documento: el cálculo y el redondeo son los de siempre (ADR-006), con la cantidad y el precio exactos. */
export type RenglonDeOrigen = Readonly<{
  descripcion: string;
  cantidad: Cantidad;
  /** El símbolo que se imprime junto a la cantidad, o `null` si no se imprime ninguno. */
  unidad: string | null;
  precioUnitario: PrecioUnitario;
  /** La alícuota del documento; en letra C fiscal la descarta. */
  alicuota: CodigoDeAlicuota | null;
}>;

export type EntradaDeFacturaDeOrigen = Readonly<{
  origen: Readonly<{ tipo: TipoDeOrigenDeFacturaDeOrigen; id: string }>;
  /** El id del comprobante: un uuid que elige quien llama y que no cambia entre reintentos. */
  comprobanteId: string;
  puntoDeVentaId: PuntoDeVentaId;
  /** La sucursal del documento: la pone quien llama desde lo que guardó, nunca el navegador. */
  sucursalEsperadaId: SucursalId;
  receptor: Receptor;
  renglones: readonly RenglonDeOrigen[];
  /** El total que se cobró (ARS); el cálculo de fiscal tiene que igualarlo al centavo. */
  totalEsperado: Importe;
}>;

/** Errores propios de esta puerta; el resto son los de emitir (`ErrorPropioAlEmitir`), el guard y la empresa que no opera. */
export type ErrorPropioDeFacturaDeOrigen = ErrorPropioAlEmitir | ErrorDeOrigen | "ORIGEN_INVALIDO";

export type ErrorAlEmitirFacturaDeOrigen =
  ErrorPropioDeFacturaDeOrigen | MotivoDeRechazo | EmpresaNoOpera;

/**
 * El cuerpo, dentro de la transacción de quien llama y con el guard primero. `contexto` lleva una persona: un trabajo de sistema no emite.
 * `reglas` es el catálogo y la matriz con los que el guard autoriza (los pasa la composición).
 */
export async function emitirFacturaDeOrigenEnTx(
  tx: TxDeFacturacion,
  contexto: ContextoOperativo &
    Readonly<{ personaId: NonNullable<ContextoOperativo["personaId"]> }>,
  entrada: EntradaDeFacturaDeOrigen,
  reglas: ReglasDeEmpresa,
): Promise<Resultado<SalidaDeEmitir, ErrorAlEmitirFacturaDeOrigen>> {
  const accion: ClaveAccion = DECLARACIONES_DE_FACTURACION.emitirFacturaDeOrigen.accion;
  const permiso = await exigirAccion(reglas, accion, () => tx.autorizacion.delActor(contexto));
  if (!permiso.ok) return permiso;
  // Lista de permitidos: el tipo de origen es uno de los dos y los ids tienen forma de uuid.
  const tipos: readonly string[] = TIPOS_DE_ORIGEN_DE_FACTURA_DE_ORIGEN;
  if (!tipos.includes(entrada.origen.tipo) || !esUuid(entrada.origen.id)) {
    return err("ORIGEN_INVALIDO");
  }
  if (!esUuid(entrada.comprobanteId)) return err("CLAVE_INVALIDA");
  const origen = { tipo: entrada.origen.tipo, id: origenId(entrada.origen.id) };
  const comoManual: EntradaDeComprobanteManual = {
    clave: entrada.comprobanteId,
    puntoDeVentaId: entrada.puntoDeVentaId,
    concepto: "PRODUCTOS",
    servicio: null,
    modoDePrecio: "IVA_INCLUIDO",
    receptor: entrada.receptor,
    renglones: entrada.renglones.map((r) => ({ ...r, descuento: null })),
  };
  return emitirEnTx(
    tx,
    contexto,
    { clase: "FACTURA", entrada: comoManual },
    {
      origen,
      comprobanteId: comprobanteId(entrada.comprobanteId),
      huella: huellaDeLaFacturaDeOrigen(origen, comoManual),
      sucursalEsperadaId: entrada.sucursalEsperadaId,
      totalEsperado: entrada.totalEsperado,
    },
  );
}

/**
 * El mismo caso de uso con su propia transacción SERIALIZABLE, para quien factura un documento sin otra cosa que guardar a la vez (y para las
 * pruebas). Declarado en `DECLARACIONES_DE_FACTURACION` como los demás; ventas usa `emitirFacturaDeOrigenEnTx` dentro de la suya.
 */
export const armarEmitirFacturaDeOrigen = ({ transacciones, reglas }: DependenciasDeFacturacion) =>
  async function emitirFacturaDeOrigen(
    contexto: ContextoOperativo,
    entrada: EntradaDeFacturaDeOrigen,
  ): Promise<Resultado<SalidaDeEmitir, ErrorAlEmitirFacturaDeOrigen | ErrorDePersistencia>> {
    const { personaId } = contexto;
    if (personaId === null) {
      throw new RangeError(
        "facturar un documento exige una persona: un trabajo de sistema no emite",
      );
    }
    const resultado = await transacciones.ejecutar({ contexto }, (tx) =>
      emitirFacturaDeOrigenEnTx(tx, { ...contexto, personaId }, entrada, reglas),
    );
    return traducirErroresDeFiscal(resultado, ADMITIDOS_AL_EMITIR);
  };
