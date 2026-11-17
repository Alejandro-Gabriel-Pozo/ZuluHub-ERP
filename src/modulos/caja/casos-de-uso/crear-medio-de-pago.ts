import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  decidirAltaDeMedio,
  nombreDeMedioValido,
  tipoDeMedioValido,
  type ErrorDeAltaDeMedio,
  type ErrorDeNombreDeMedio,
} from "../dominio/configuracion";
import { dejarConstancia, prepararCaso } from "./comun";
import type { DependenciasDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeCrearMedioDePago = Readonly<{
  tipo: string;
  /** `null`: sin nombre propio; la pantalla usa el vocabulario del tipo. */
  nombre: string | null;
}>;

export type SalidaDeCrearMedioDePago = Readonly<{
  medioDePagoId: string;
  /** `true`: ya existía ese mismo medio activo; no se escribió nada. */
  yaExistia: boolean;
}>;

type ErrorPropio = "TIPO_DE_MEDIO_INVALIDO" | ErrorDeNombreDeMedio | ErrorDeAltaDeMedio;

export type ErrorAlCrearMedioDePago =
  ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso (red de seguridad: antes decide el dominio). */
const RESTRICCIONES_ADMITIDAS = [
  "TIPO_DE_MEDIO_INVALIDO",
  "NOMBRE_DE_MEDIO_INVALIDO",
  "MEDIO_DUPLICADO",
  "EFECTIVO_YA_EXISTE",
] as const;

/**
 * Crear un medio de pago de la empresa (e3 §3.2). Contexto OPERATIVO con persona, en una transacción serializable: guard
 * (`medios_de_pago.crear`), la empresa opera, validación del tipo y del nombre, y el dominio decide (`decidirAltaDeMedio`):
 *  - el mismo medio ya activo (mismo nombre y tipo; sin nombre, mismo tipo) → `yaExistia: true` sin escribir ni auditar;
 *  - el nombre lo usa un medio de otro tipo → `MEDIO_DUPLICADO`; uno desactivado → `MEDIO_INACTIVO_CON_ESE_NOMBRE`;
 *  - ya hay efectivo y se pide otro → `EFECTIVO_YA_EXISTE`;
 *  - si no, se inserta (nace activo y sin pedir ningún dato: decisión 129) y se audita `MEDIO_DE_PAGO_CREADO`.
 * El id lo genera la base. Dos altas iguales a la vez dejan uno: la segunda, tras el reintento serializable, ve el primero.
 */
export function armarCrearMedioDePago({ transacciones, reglas }: DependenciasDeCaja) {
  return async function crearMedioDePago(
    contexto: ContextoOperativo,
    entrada: EntradaDeCrearMedioDePago,
  ): Promise<Resultado<SalidaDeCrearMedioDePago, ErrorAlCrearMedioDePago>> {
    const { empresaId } = contexto;
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<SalidaDeCrearMedioDePago, ErrorPropio | MotivoDeRechazo | EmpresaNoOpera>
      > => {
        const previo = await prepararCaso(
          tx,
          contexto,
          reglas,
          DECLARACIONES.crearMedioDePago.accion,
        );
        if (!previo.ok) return previo;
        const tipo = tipoDeMedioValido(entrada.tipo);
        if (!tipo.ok) return tipo;
        const nombre = nombreDeMedioValido(entrada.nombre);
        if (!nombre.ok) return nombre;

        const conEseNombre =
          nombre.valor === null
            ? await tx.mediosDePago.obtenerSinNombre(empresaId, tipo.valor)
            : await tx.mediosDePago.obtenerPorNombre(empresaId, nombre.valor);
        const efectivo =
          tipo.valor === "EFECTIVO" ? await tx.mediosDePago.obtenerEfectivo(empresaId) : null;
        const decision = decidirAltaDeMedio(
          { tipo: tipo.valor, nombre: nombre.valor },
          { conEseNombre, efectivo },
        );
        if (!decision.ok) return decision;
        if (decision.valor === "YA_EXISTIA") {
          const existente = tipo.valor === "EFECTIVO" ? efectivo : conEseNombre;
          if (existente === null) throw new Error("invariante rota: ya existía un medio nulo");
          return ok({ medioDePagoId: existente.id, yaExistia: true });
        }

        const medio = await tx.mediosDePago.crear(empresaId, tipo.valor, nombre.valor);
        await dejarConstancia(tx, contexto, previo.valor.persona, {
          accion: "MEDIO_DE_PAGO_CREADO",
          entidad: "medio_de_pago",
          entidadId: medio.id,
          despues: { tipo: medio.tipo, nombre: medio.nombre, activo: true },
        });
        return ok({ medioDePagoId: medio.id, yaExistia: false });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
