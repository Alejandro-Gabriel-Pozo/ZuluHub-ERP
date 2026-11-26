import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { hoyEnArgentina } from "../../../primitivas/tiempo/fecha-civil-hasta-hoy";
import { estaVencida, movimientosDeLasPartes } from "../../saldos_de_partes/publico";
import { datosDeLosClientes } from "../consultas/datos-de-clientes";
import {
  armarFilasDeLaExportacion,
  FILAS_MAXIMAS_DE_LA_EXPORTACION,
  origenDeLaExportacion,
  type FilaDeExportacion,
  type MovimientoParaExportar,
} from "../dominio/exportacion";
import { prepararCaso, type ErrorPrevio } from "./comun";
import type { DependenciasDeCuentaCorriente } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";

export type SalidaDeExportarCuentaCorriente = Readonly<{
  /** La fecha de negocio (Argentina) al que se calcularon la antigüedad y «vencida». */
  alDia: string;
  /** Cuántos clientes con ficha entraron. */
  clientes: number;
  filas: readonly FilaDeExportacion[];
}>;

export type ErrorAlExportarCuentaCorriente =
  | ErrorPrevio
  | "EXPORTACION_NO_DISPONIBLE"
  | "EXPORTACION_DEMASIADO_GRANDE"
  | "FECHA_INVALIDA"
  | ErrorDePersistencia;

/**
 * Exportar la cuenta corriente de TODOS los clientes con ficha, en formato plano para tablas dinámicas (CC-4). Lee fichas, movimientos del libro, medios de pago de las cobranzas y
 * nombres de sucursal dentro de UNA transacción `serializable` (una foto: una cobranza que entra a mitad no deja un archivo que mezcla antes y después) y deja el registro de
 * auditoría en esa misma transacción: quién, cuándo (lo sella la fila), a qué día y cuántas filas, SIN los datos. Es de LECTURA: repetirla da lo mismo y deja otro registro. Por encima
 * de `FILAS_MAXIMAS_DE_LA_EXPORTACION` rechaza el pedido entero. El archivo se genera DESPUÉS, fuera de la transacción, con lo que devuelve. Si el registro falla, no sale nada.
 * Exige `cuenta_corriente.ver` (sin permiso nuevo: hoy gerente y administrador).
 */
export function armarExportarCuentaCorriente(
  dependencias: DependenciasDeCuentaCorriente,
  /** El tope de filas; solo las pruebas lo cambian. */
  filasMaximas: number = FILAS_MAXIMAS_DE_LA_EXPORTACION,
) {
  return async function exportarCuentaCorriente(
    contexto: ContextoOperativo,
  ): Promise<Resultado<SalidaDeExportarCuentaCorriente, ErrorAlExportarCuentaCorriente>> {
    const apoyo = dependencias.apoyoDeLaExportacion;
    const hoy = hoyEnArgentina(contexto.ahora);
    return dependencias.transacciones.ejecutar(
      { contexto, aislamiento: "serializable" },
      async (
        tx,
      ): Promise<Resultado<SalidaDeExportarCuentaCorriente, ErrorAlExportarCuentaCorriente>> => {
        const previo = await prepararCaso(
          tx,
          contexto,
          dependencias.reglas,
          DECLARACIONES.exportarCuentaCorriente.accion,
        );
        if (!previo.ok) return previo;
        if (apoyo === undefined) return err("EXPORTACION_NO_DISPONIBLE");
        if (!hoy.ok) return err("FECHA_INVALIDA");
        const empresa = contexto.empresaId;

        const fichas = await tx.cuentasDeClientes.listar(empresa);
        const ids = fichas.map((f) => f.parteId);
        const movimientos = await movimientosDeLasPartes(
          tx,
          contexto,
          ids,
          "A_COBRAR",
          filasMaximas,
        );
        if (movimientos.length > filasMaximas) return err("EXPORTACION_DEMASIADO_GRANDE");

        const paraExportar: MovimientoParaExportar[] = movimientos.map((m) => ({
          asientoId: m.asientoId,
          parteId: m.parteId,
          clase: m.clase,
          importe: m.importe,
          pendiente: m.pendiente,
          anulado: m.anulado,
          // Vencida: un cargo vigente con algo por saldar cuyo vencimiento ya pasó (la regla del libro, una sola).
          vencida: m.pendiente.unidades > 0n && estaVencida(m.venceEl, hoy.valor),
          fechaNegocio: m.fechaNegocio,
          venceEl: m.venceEl,
          origenTipo: m.origenTipo,
          origenId: m.origenId,
          sucursales: m.sucursales,
        }));
        const cobranzaIds = [
          ...new Set(
            paraExportar
              .filter((m) => origenDeLaExportacion(m.origenTipo) === "COBRANZA")
              .map((m) => m.origenId),
          ),
        ];
        const sucursalIds = [
          ...new Set(
            paraExportar.flatMap((m) => m.sucursales.filter((s): s is string => s !== null)),
          ),
        ];
        const medios = await apoyo.mediosDeCobranza(tx, empresa, cobranzaIds);
        const sucursales = await apoyo.nombresDeSucursales(tx, empresa, sucursalIds);
        const clientes = await datosDeLosClientes(tx, empresa, ids);
        const filas = armarFilasDeLaExportacion(
          paraExportar,
          clientes,
          medios,
          sucursales,
          hoy.valor,
        );

        // La auditoría, en la misma transacción: quién, cuándo (lo fija la base), a qué día y cuántas filas. Nunca los datos.
        await tx.auditoria.registrar({
          empresaId: empresa,
          actorPersonaId: previo.valor.persona,
          accion: "CUENTA_CORRIENTE_EXPORTADA",
          entidad: "exportacion_de_cuenta_corriente",
          entidadId: hoy.valor,
          despues: { alDia: hoy.valor, clientes: fichas.length, filas: filas.length },
        });
        return ok({ alDia: hoy.valor, clientes: fichas.length, filas });
      },
    );
  };
}
