import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  decidirAltaDeCuenta,
  identificadorExternoValido,
  nombreDeCuentaValido,
  tipoDeCuentaValido,
  type ErrorDeIdentificadorExterno,
  type ErrorDeNombreDeCuenta,
} from "../dominio/configuracion";
import { dejarConstancia, exigirAlcance, prepararCaso, sucursalDeLaEntrada } from "./comun";
import type { DependenciasDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeCrearCuentaDeCobro = Readonly<{
  tipo: string;
  nombre: string;
  /** El número de terminal o el alias; `null`: sin dato. Nunca una credencial. */
  identificadorExterno: string | null;
  sucursalId: string;
}>;

export type SalidaDeCrearCuentaDeCobro = Readonly<{
  cuentaDeCobroId: string;
  /** `true`: ya existía esa misma cuenta activa; no se escribió nada. */
  yaExistia: boolean;
}>;

type ErrorPropio =
  | "TIPO_DE_CUENTA_INVALIDO"
  | ErrorDeNombreDeCuenta
  | ErrorDeIdentificadorExterno
  | "SUCURSAL_NO_ENCONTRADA"
  | "CUENTA_DUPLICADA";

export type ErrorAlCrearCuentaDeCobro =
  ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso (red de seguridad: antes decide el dominio). */
const RESTRICCIONES_ADMITIDAS = [
  "TIPO_DE_CUENTA_INVALIDO",
  "NOMBRE_DE_CUENTA_INVALIDO",
  "IDENTIFICADOR_EXTERNO_INVALIDO",
  "SUCURSAL_NO_ENCONTRADA",
  "CUENTA_DUPLICADA",
] as const;

/**
 * Crear una cuenta de cobro (terminal, QR o cuenta bancaria) de una sucursal (e3 §3.2 y §3.3). Contexto OPERATIVO con persona, en una
 * transacción serializable: guard (`cuentas_de_cobro.crear`), la empresa opera, alcance sobre la sucursal de la cuenta, validación del
 * tipo, el nombre y el identificador, y el dominio decide (`decidirAltaDeCuenta`):
 *  - la misma cuenta ya activa (mismo nombre, tipo, identificador y sucursal) → `yaExistia: true` sin escribir ni auditar;
 *  - el nombre (sin distinguir mayúsculas) lo usa otra cuenta, o la misma desactivada → `CUENTA_DUPLICADA`;
 *  - si no, la sucursal tiene que existir (leída con `FOR SHARE`), se inserta y se audita `CUENTA_DE_COBRO_CREADA`.
 * La auditoría no lleva el identificador externo, solo si tiene uno. El id lo genera la base.
 */
export function armarCrearCuentaDeCobro({ transacciones, reglas }: DependenciasDeCaja) {
  return async function crearCuentaDeCobro(
    contexto: ContextoOperativo,
    entrada: EntradaDeCrearCuentaDeCobro,
  ): Promise<Resultado<SalidaDeCrearCuentaDeCobro, ErrorAlCrearCuentaDeCobro>> {
    const { empresaId } = contexto;
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeCrearCuentaDeCobro,
          ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance
        >
      > => {
        const previo = await prepararCaso(
          tx,
          contexto,
          reglas,
          DECLARACIONES.crearCuentaDeCobro.accion,
        );
        if (!previo.ok) return previo;
        const sucursal = sucursalDeLaEntrada(entrada.sucursalId);
        if (!sucursal.ok) return sucursal;
        const alcance = await exigirAlcance(tx, contexto, sucursal.valor);
        if (!alcance.ok) return alcance;
        const tipo = tipoDeCuentaValido(entrada.tipo);
        if (!tipo.ok) return tipo;
        const nombre = nombreDeCuentaValido(entrada.nombre);
        if (!nombre.ok) return nombre;
        const identificador = identificadorExternoValido(entrada.identificadorExterno);
        if (!identificador.ok) return identificador;

        const existente = await tx.cuentasDeCobro.obtenerPorNombre(empresaId, nombre.valor);
        const pedido = {
          tipo: tipo.valor,
          identificadorExterno: identificador.valor,
          sucursalId: sucursal.valor,
        };
        const decision = decidirAltaDeCuenta(pedido, existente);
        if (!decision.ok) return decision;
        if (decision.valor === "YA_EXISTIA") {
          if (existente === null) throw new Error("invariante rota: ya existía una cuenta nula");
          return ok({ cuentaDeCobroId: existente.id, yaExistia: true });
        }

        const deLaSucursal = await tx.sucursalBloqueada.obtenerBloqueandoElCierre(
          empresaId,
          sucursal.valor,
        );
        if (deLaSucursal === null) return err("SUCURSAL_NO_ENCONTRADA");
        const cuenta = await tx.cuentasDeCobro.crear(empresaId, {
          ...pedido,
          nombre: nombre.valor,
        });
        await dejarConstancia(tx, contexto, previo.valor.persona, {
          accion: "CUENTA_DE_COBRO_CREADA",
          entidad: "cuenta_de_cobro",
          entidadId: cuenta.id,
          despues: {
            tipo: cuenta.tipo,
            nombre: cuenta.nombre,
            sucursalId: cuenta.sucursalId,
            conIdentificadorExterno: cuenta.identificadorExterno !== null,
            activa: true,
          },
        });
        return ok({ cuentaDeCobroId: cuenta.id, yaExistia: false });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
