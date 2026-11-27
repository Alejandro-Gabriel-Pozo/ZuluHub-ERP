import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { huellaDeLaFacturaSeparada, leerFacturaSeparada } from "../dominio/conciliacion-separada";
import { decidirPorHuella } from "../dominio/huella";
import { esUuid } from "../dominio/identificadores";
import { motivoDeAnulacionDesdeTexto } from "../dominio/registrar-compra";
import type { ComprobanteGuardado } from "../persistencia/repositorio-de-comprobantes";
import { anularElCargoDeLaFactura } from "./cargo-de-la-factura";
import { autorizar, exigirAlcanceDelComprobante, traducir } from "./comun";
import type { DependenciasDeCompras, TxDeCompras } from "./contrato";
import type { ErrorDeCompras } from "./errores";
import { esFacturaReemplazable, frenosDeLaFactura } from "./frenos-del-reemplazo";
import { exigirNivelSeparado } from "./nivel-separado";
import { registrarFacturaEnTx, type SalidaDeRegistrarFactura } from "./registrar-factura";

type R<S> = Resultado<S, ErrorDeCompras>;

/** Un chequeo de otro tema que frena el reemplazo (por ejemplo, SERV-3 o ACT-2): devuelve el error con el que falla cerrado, o `null` si no frena. Vacío en este PR. */
export type FrenoPropioDelReemplazo = (
  tx: TxDeCompras,
  contexto: ContextoOperativo,
  original: ComprobanteGuardado,
) => Promise<ErrorDeCompras | null>;

/** Lo que otro tema hereda de la factura reemplazada a la nueva (reparto, conforme, bienes: SERV-3 y ACT-2), DENTRO de la misma transacción y después de registrar la nueva. Vacío en este PR. */
export type HeredadorDelReemplazo = (
  tx: TxDeCompras,
  contexto: ContextoOperativo,
  facturas: Readonly<{ originalId: string; nuevaId: string }>,
) => Promise<R<null>>;

export type ExtensionesDelReemplazo = Readonly<{
  frenos: readonly FrenoPropioDelReemplazo[];
  heredadores: readonly HeredadorDelReemplazo[];
}>;

export type EntradaDeReemplazarFactura = Readonly<{
  /** Un UUID que genera la pantalla al abrir: es la idempotencia del reemplazo. */
  clave: string;
  /** La factura que el proveedor anuló y se reemplaza. */
  comprobanteId: string;
  /** Por qué se reemplaza: queda en la anulación de la original (lo escribe quien reemplaza; el sistema no inventa textos). */
  motivo: string;
  /** La factura nueva, como la de `registrarFactura` (del mismo proveedor, sin su `proveedorId`). */
  factura: unknown;
}>;

export type SalidaDeReemplazarFactura = SalidaDeRegistrarFactura;

/**
 * Reemplazar una factura (NOTAS-2, N-E; N3 y N4, la que llega sola): «el proveedor anuló la factura y mandó otra». UNA operación atómica: bloquea la original, verifica que nada la frene, la anula con motivo, registra la nueva con el
 * vínculo `reemplazaAId` (mismo proveedor), deja el espejo del cargo de la original y el cargo de la nueva en el libro, ejecuta lo que otros temas hereden y audita `FACTURA_REEMPLAZADA` con las dos facturas. Todo o nada.
 * Guard: `comprobantes_de_proveedor.reemplazar` Y las de los pasos que ejecuta (`anular` y `registrar`); alcance sobre todas las sucursales de la original (la nueva no tiene recepción). NO anula el pago, las conciliaciones ni
 * las notas: si la original tiene alguno falla cerrado con el código del primero (`COMPROBANTE_YA_PAGADO` con el id del pago, `COMPROBANTE_CONCILIADO`, `COMPROBANTE_CON_NOTA_DE_CREDITO`). El pago NO se hereda: se anula antes y se
 * paga la nueva. El número puede ser el mismo (el proveedor lo reutiliza): la original se anula ANTES de registrar la nueva y el vínculo lo deja marcado en la auditoría (`mismoNumero`). Repetición: misma clave y mismo contenido
 * devuelve la misma factura nueva (`yaExistia`) sin escribir ni auditar; otro contenido, `CLAVE_REUTILIZADA`; reemplazar dos veces la misma original, `FACTURA_YA_REEMPLAZADA` con el id del reemplazo vigente.
 */
export function armarReemplazarFactura(
  dependencias: DependenciasDeCompras,
  extensiones: ExtensionesDelReemplazo = { frenos: [], heredadores: [] },
) {
  return async function reemplazarFactura(
    contexto: ContextoOperativo,
    entrada: EntradaDeReemplazarFactura,
  ): Promise<R<SalidaDeReemplazarFactura>> {
    const { empresaId } = contexto;
    if (contexto.personaId === null) return err("SIN_PERMISO");
    const persona = contexto.personaId;
    if (!esUuid(entrada.clave) || !esUuid(entrada.comprobanteId)) {
      return err("IDENTIFICADOR_INVALIDO");
    }
    const motivo = motivoDeAnulacionDesdeTexto(entrada.motivo);
    if (!motivo.ok) return motivo;
    const leida = leerFacturaSeparada(entrada.factura);
    if (!leida.ok) return leida;
    return traducir(
      await dependencias.transacciones.ejecutar(
        { contexto },
        async (tx): Promise<R<SalidaDeReemplazarFactura>> => {
          const permiso = await autorizar(tx, contexto, dependencias.reglas, [
            "comprobantes_de_proveedor.reemplazar",
            "comprobantes_de_proveedor.anular",
            "comprobantes_de_proveedor.registrar",
          ]);
          if (!permiso.ok) return permiso;
          const nivel = await exigirNivelSeparado(tx, contexto);
          if (!nivel.ok) return nivel;
          const original = await tx.comprobantesDeProveedor.bloquear(
            empresaId,
            entrada.comprobanteId,
          );
          if (!esFacturaReemplazable(original)) return err("COMPROBANTE_NO_ENCONTRADO");
          const alcance = await exigirAlcanceDelComprobante(tx, contexto, original.id);
          if (!alcance.ok) return alcance;
          const huella = huellaDeLaFacturaSeparada(original.proveedorId, leida.valor);
          const previa = await tx.comprobantesDeProveedor.porClave(empresaId, entrada.clave);
          if (previa !== null) {
            return previa.reemplazaAId === original.id &&
              decidirPorHuella(previa.huella, huella) === "REPETIDA"
              ? ok({ comprobanteId: previa.id, yaExistia: true, avisos: [] })
              : err("CLAVE_REUTILIZADA");
          }
          if (original.estado === "ANULADO") {
            const vigente = await tx.comprobantesDeProveedor.reemplazoVigenteDe(
              empresaId,
              original.id,
            );
            return vigente === null
              ? err("COMPROBANTE_ANULADO")
              : err({ error: "FACTURA_YA_REEMPLAZADA", reemplazoId: vigente.id });
          }
          // Lo que hay que deshacer antes: el primero que se encuentre, en su orden (pago, conciliaciones, notas) y después lo que sume otro tema.
          const frenos = await frenosDeLaFactura(tx, empresaId, original.id);
          if (frenos[0] !== undefined) return err(frenos[0].error);
          for (const freno of extensiones.frenos) {
            const error = await freno(tx, contexto, original);
            if (error !== null) return err(error);
          }
          const anulada = await tx.comprobantesDeProveedor.anular(empresaId, original.id, {
            por: persona,
            en: contexto.ahora,
            motivo: motivo.valor,
          });
          if (!anulada) throw new Error("la factura ya no estaba registrada bajo bloqueo");
          const espejo = await anularElCargoDeLaFactura(tx, contexto, dependencias, original.id);
          if (!espejo.ok) return espejo;
          const nueva = await registrarFacturaEnTx(tx, contexto, dependencias, {
            clave: entrada.clave,
            proveedorId: original.proveedorId,
            leida: leida.valor,
            huella,
            nivel: nivel.valor,
            reemplazaAId: original.id,
          });
          if (!nueva.ok) return nueva;
          for (const heredar of extensiones.heredadores) {
            const heredado = await heredar(tx, contexto, {
              originalId: original.id,
              nuevaId: nueva.valor.comprobanteId,
            });
            if (!heredado.ok) return heredado;
          }
          const f = leida.valor.factura;
          await tx.auditoria.registrar({
            empresaId,
            actorPersonaId: persona,
            accion: "FACTURA_REEMPLAZADA",
            entidad: "comprobante_de_proveedor",
            entidadId: original.id,
            antes: { estado: "REGISTRADO" },
            despues: {
              estado: "ANULADO",
              motivo: motivo.valor,
              reemplazadaPor: nueva.valor.comprobanteId,
              fechaDeLaOriginal: original.fechaDelComprobante,
              fechaDeLaNueva: f.fecha,
              // El proveedor reutilizó el número de la factura anulada: no es una aceptación silenciosa (RP-9).
              mismoNumero:
                f.tipo === original.tipo &&
                f.puntoDeVenta === original.puntoDeVenta &&
                f.numero === original.numero,
            },
          });
          return nueva;
        },
      ),
    );
  };
}
