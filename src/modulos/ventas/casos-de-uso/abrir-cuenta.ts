import type { ContextoOperativo } from "../../../contexto/contexto";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { anclaValida, etiquetaDeCuenta, type Ancla } from "../dominio/ancla";
import { departamentoDeLaCuenta } from "../dominio/departamento";
import { cuentaId, type CuentaId } from "../dominio/identificadores";
import type { Cuenta } from "../persistencia/repositorio-de-cuentas";
import {
  exigirAlcance,
  exigirJornadaAbierta,
  type OpcionesDeLaVenta,
  exigirUuid,
  prepararComando,
  traducir,
} from "./comun";
import type { DependenciasDeVentas, TxDeVentas } from "./contrato";
import type { ErrorDeVentas } from "./errores";

type R<S> = Resultado<S, ErrorDeVentas>;

export type EntradaDeAbrirCuenta = Readonly<{
  /** Lo manda la pantalla: es la clave de idempotencia del alta. */
  cuentaId: string;
  sucursalId: string;
  /**
   * A2c: el departamento en el que se abre (el del selector de la pantalla; se fija y no cambia). Ausente: con dos o más departamentos activos es
   * `DEPARTAMENTO_REQUERIDO` (nunca se asume «todos»); con uno solo lo toma; sin departamentos queda sin departamento (`departamentoDeLaCuenta`).
   */
  departamentoId?: string | undefined;
  ancla?: Ancla | undefined;
  etiqueta?: string | undefined;
}>;

export type SalidaDeAbrirCuenta = Readonly<{ cuentaId: CuentaId; yaExistia: boolean }>;

/** ¿La cuenta ya guardada es lo que este pedido pediría? (mismo id y mismo contenido → repetición). */
function esLoMismo(
  guardada: Cuenta,
  pedido: Readonly<{
    sucursal: string;
    ancla: Ancla | null;
    etiqueta: string | null;
    /** Solo si el pedido lo nombró: una repetición que no lo manda acepta el que quedó guardado. */
    departamentoId: string | undefined;
  }>,
): boolean {
  return (
    guardada.sucursalId === pedido.sucursal &&
    guardada.etiqueta === pedido.etiqueta &&
    (pedido.departamentoId === undefined || guardada.departamentoId === pedido.departamentoId) &&
    (guardada.ancla === null
      ? pedido.ancla === null
      : pedido.ancla !== null &&
        guardada.ancla.tipo === pedido.ancla.tipo &&
        guardada.ancla.id === pedido.ancla.id)
  );
}

/**
 * `abrirCuenta` (E4 §3.4). Una transacción serializable: guard (`cuentas.abrir`), la empresa opera, la sucursal está en el alcance de quien
 * pide, existe y está abierta, la jornada está abierta (`JORNADA_EN_AUDITORIA` / `JORNADA_CERRADA`), y entonces valida ancla y etiqueta y
 * escribe. El `cuentaId` lo manda la pantalla: repetir el pedido devuelve la misma cuenta (`yaExistia`); el mismo id con otro contenido es
 * `CUENTA_ID_EN_USO`. Con el ancla ocupada por otra cuenta abierta devuelve ESA cuenta (a lo sumo una abierta por ancla). Audita
 * `CUENTA_ABIERTA` en la misma transacción.
 */
export async function abrirCuentaEnTx(
  tx: TxDeVentas,
  contexto: ContextoOperativo,
  persona: PersonaId,
  entrada: EntradaDeAbrirCuenta,
  opciones: OpcionesDeLaVenta = {},
): Promise<R<SalidaDeAbrirCuenta>> {
  const { empresaId } = contexto;
  const ids = exigirUuid(entrada.cuentaId, entrada.sucursalId);
  if (!ids.ok) return ids;
  const sucursal = sucursalId(entrada.sucursalId);
  const alcance = await exigirAlcance(tx, contexto, sucursal);
  if (!alcance.ok) return alcance;
  const fila = await tx.sucursales.obtener(empresaId, sucursal);
  if (fila === null) return err("SUCURSAL_NO_ENCONTRADA");
  if (!fila.activa) return err("SUCURSAL_INACTIVA");
  const jornada = await exigirJornadaAbierta(tx, contexto, sucursal, opciones.jornada);
  if (!jornada.ok) return jornada;

  const ancla = entrada.ancla === undefined ? null : anclaValida(entrada.ancla);
  if (ancla !== null && !ancla.ok) return ancla;
  const etiqueta = entrada.etiqueta === undefined ? null : etiquetaDeCuenta(entrada.etiqueta);
  if (etiqueta !== null && !etiqueta.ok) return etiqueta;
  const pedido = {
    sucursal,
    ancla: ancla === null ? null : ancla.valor,
    etiqueta: etiqueta === null ? null : etiqueta.valor,
    departamentoId: entrada.departamentoId,
  };

  const id = cuentaId(entrada.cuentaId);
  const guardada = await tx.cuentas.obtener(empresaId, id);
  if (guardada !== null) {
    return esLoMismo(guardada, pedido)
      ? ok({ cuentaId: id, yaExistia: true })
      : err("CUENTA_ID_EN_USO");
  }
  if (pedido.ancla !== null) {
    const ocupada = await tx.cuentas.abiertaPorAncla(empresaId, pedido.ancla);
    if (ocupada !== null) return ok({ cuentaId: ocupada.id, yaExistia: true });
  }
  // El departamento se decide recién acá, sobre lo que hay AHORA en la empresa, y solo para una cuenta nueva (la repetición ya devolvió la guardada).
  let departamento: string | null;
  if (opciones.departamentoDeLaMadre !== undefined) {
    departamento = opciones.departamentoDeLaMadre.id;
  } else {
    const elegido = departamentoDeLaCuenta(
      await tx.clasificacion.todos(empresaId),
      entrada.departamentoId,
    );
    if (!elegido.ok) return elegido;
    departamento = elegido.valor;
  }
  const insertada = await tx.cuentas.insertar(empresaId, {
    id,
    sucursalId: sucursal,
    departamentoId: departamento,
    ancla: pedido.ancla,
    etiqueta: pedido.etiqueta,
    abiertaPor: persona,
    abiertaEn: contexto.ahora,
  });
  if (!insertada) {
    const repetida = await tx.cuentas.obtener(empresaId, id);
    return repetida !== null && esLoMismo(repetida, pedido)
      ? ok({ cuentaId: id, yaExistia: true })
      : err("CUENTA_ID_EN_USO");
  }
  await tx.auditoria.registrar({
    empresaId,
    actorPersonaId: persona,
    accion: "CUENTA_ABIERTA",
    entidad: "cuenta_consumo",
    entidadId: id,
    despues: {
      sucursalId: sucursal,
      departamentoId: departamento,
      anclaTipo: pedido.ancla === null ? null : pedido.ancla.tipo,
      anclaId: pedido.ancla === null ? null : pedido.ancla.id,
      etiqueta: pedido.etiqueta,
    },
  });
  return ok({ cuentaId: id, yaExistia: false });
}

async function abrir(
  tx: TxDeVentas,
  dependencias: DependenciasDeVentas,
  contexto: ContextoOperativo,
  entrada: EntradaDeAbrirCuenta,
): Promise<R<SalidaDeAbrirCuenta>> {
  const persona = await prepararComando(tx, contexto, dependencias.reglas, ["cuentas.abrir"]);
  if (!persona.ok) return persona;
  return abrirCuentaEnTx(tx, contexto, persona.valor, entrada);
}

export function armarAbrirCuenta(dependencias: DependenciasDeVentas) {
  return async function abrirCuenta(
    contexto: ContextoOperativo,
    entrada: EntradaDeAbrirCuenta,
  ): Promise<R<SalidaDeAbrirCuenta>> {
    const resultado = await dependencias.transacciones.ejecutar({ contexto }, (tx) =>
      abrir(tx, dependencias, contexto, entrada),
    );
    const traducido = traducir(resultado);
    if (traducido.ok || traducido.error !== "ANCLA_OCUPADA" || entrada.ancla === undefined) {
      return traducido;
    }
    // Dos aperturas simultáneas del mismo ancla: la segunda perdió por la única de la base y la transacción se revirtió; se devuelve la
    // cuenta abierta que ganó (a lo sumo una por ancla), que es lo que hubiera devuelto la segunda si hubiera llegado después.
    const ancla = entrada.ancla;
    return dependencias.transacciones.ejecutar(
      { contexto, soloLectura: true, aislamiento: "read committed" },
      async (tx) => {
        const ganadora = await tx.cuentas.abiertaPorAncla(contexto.empresaId, ancla);
        return ganadora === null
          ? err("ANCLA_OCUPADA")
          : ok({ cuentaId: ganadora.id, yaExistia: true });
      },
    );
  };
}
