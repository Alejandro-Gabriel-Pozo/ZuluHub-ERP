import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import { exigirPerilla, type ErrorDePerilla } from "../../../capacidades/planes/derechos";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  decidirAltaDeCaja,
  nombreDeCajaValido,
  type ErrorDeNombreDeCaja,
} from "../dominio/configuracion";
import { dejarConstancia, exigirAlcance, prepararCaso, sucursalDeLaEntrada } from "./comun";
import type { DependenciasDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeCrearCaja = Readonly<{ sucursalId: string; nombre: string }>;

export type SalidaDeCrearCaja = Readonly<{
  cajaId: string;
  /** `true`: ya había una caja activa con ese nombre en la sucursal; no se escribió nada. */
  yaExistia: boolean;
}>;

type ErrorPropio =
  | ErrorDeNombreDeCaja
  | "SUCURSAL_NO_ENCONTRADA"
  | "SUCURSAL_INACTIVA"
  | "CAJA_INACTIVA_CON_ESE_NOMBRE"
  | ErrorDePerilla;

export type ErrorAlCrearCaja =
  | ErrorPropio
  | "CAJA_DUPLICADA"
  | MotivoDeRechazo
  | EmpresaNoOpera
  | ErrorDeAlcance
  | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso (red de seguridad: antes decide el dominio). */
const RESTRICCIONES_ADMITIDAS = [
  "NOMBRE_DE_CAJA_INVALIDO",
  "CAJA_DUPLICADA",
  "SUCURSAL_NO_ENCONTRADA",
] as const;

/**
 * Crear una caja en una sucursal (e3 §3.2). Contexto OPERATIVO con persona, en una transacción serializable: guard (`cajas.crear`), la
 * empresa opera, alcance de sucursal, validación del nombre, y entonces:
 *  - ya hay una caja con ese nombre (sin distinguir mayúsculas): activa → `yaExistia: true` sin escribir ni auditar (doble clic o
 *    reintento); desactivada → `CAJA_INACTIVA_CON_ESE_NOMBRE` (se la reactiva);
 *  - la sucursal existe y está abierta (leída con `FOR SHARE`: un cierre concurrente espera) y las cajas ACTIVAS de la sucursal están por
 *    debajo del límite del plan (`cajas_por_sucursal`, contadas en esta transacción: dos altas a la vez no pasan las dos);
 *  - se inserta la caja, se asegura el medio efectivo de la empresa y se audita `CAJA_CREADA` (y `MEDIO_DE_PAGO_CREADO` si el efectivo
 *    no estaba) en la misma transacción.
 * El id lo genera la base.
 */
export function armarCrearCaja({ transacciones, reglas }: DependenciasDeCaja) {
  return async function crearCaja(
    contexto: ContextoOperativo,
    entrada: EntradaDeCrearCaja,
  ): Promise<Resultado<SalidaDeCrearCaja, ErrorAlCrearCaja>> {
    const { empresaId } = contexto;
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeCrearCaja,
          ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance
        >
      > => {
        const previo = await prepararCaso(tx, contexto, reglas, DECLARACIONES.crearCaja.accion);
        if (!previo.ok) return previo;
        const sucursal = sucursalDeLaEntrada(entrada.sucursalId);
        if (!sucursal.ok) return sucursal;
        const alcance = await exigirAlcance(tx, contexto, sucursal.valor);
        if (!alcance.ok) return alcance;
        const nombre = nombreDeCajaValido(entrada.nombre);
        if (!nombre.ok) return nombre;

        const existente = await tx.cajas.obtenerPorNombre(empresaId, sucursal.valor, nombre.valor);
        const decision = decidirAltaDeCaja(existente);
        if (!decision.ok) return decision;
        if (decision.valor === "YA_EXISTIA") {
          if (existente === null) throw new Error("invariante rota: ya existía una caja nula");
          return ok({ cajaId: existente.id, yaExistia: true });
        }

        const deLaSucursal = await tx.sucursalBloqueada.obtenerBloqueandoElCierre(
          empresaId,
          sucursal.valor,
        );
        if (deLaSucursal === null) return err("SUCURSAL_NO_ENCONTRADA");
        if (!deLaSucursal.activa) return err("SUCURSAL_INACTIVA");

        const derechos = await tx.derechos.deLaEmpresa(contexto);
        const enUso = await tx.cajas.contarActivas(empresaId, sucursal.valor);
        const tope = exigirPerilla(
          derechos,
          "cajas_por_sucursal",
          { empresaId, sucursalId: sucursal.valor },
          enUso,
        );
        if (!tope.ok) return tope;

        const caja = await tx.cajas.crear(empresaId, sucursal.valor, nombre.valor);
        await dejarConstancia(tx, contexto, previo.valor.persona, {
          accion: "CAJA_CREADA",
          entidad: "caja",
          entidadId: caja.id,
          despues: { nombre: caja.nombre, sucursalId: caja.sucursalId, activa: true },
        });
        const efectivo = await tx.mediosDePago.asegurarEfectivo(empresaId);
        if (efectivo.creado) {
          await dejarConstancia(tx, contexto, previo.valor.persona, {
            accion: "MEDIO_DE_PAGO_CREADO",
            entidad: "medio_de_pago",
            entidadId: efectivo.medio.id,
            despues: { tipo: "EFECTIVO", nombre: null, activo: true, origen: "caja" },
          });
        }
        return ok({ cajaId: caja.id, yaExistia: false });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
