import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { importeATexto } from "../../../primitivas/dinero/importe";
import { esUuidCanonico } from "../../../primitivas/identificadores/marca";
import { decidirPorHuella, exigirClave } from "../../../primitivas/libro/publico";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  huellaDeHabilitacion,
  limiteValido,
  plazoValido,
  type ErrorDeLimite,
  type ErrorDePlazo,
} from "../dominio/condiciones";
import { aCuentaPublica, type CuentaPublica } from "./cuenta-publica";
import {
  dejarConstancia,
  prepararCaso,
  repetirSiOtroGano,
  UNICAS_DE_LA_HABILITACION,
} from "./comun";
import type { DependenciasDeCuentaCorriente } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeHabilitarCuenta = Readonly<{
  /** La genera la pantalla al abrir el formulario: repetir el pedido (doble clic, reintento de red) no duplica la ficha. */
  claveDeIdempotencia: string;
  parteId: string;
  /** Días de plazo, entero entre 1 y 365. */
  plazoDias: number;
  /** Límite de crédito en pesos: texto decimal con punto y hasta 2 decimales (nunca `number`). */
  limite: string;
}>;

export type SalidaDeHabilitarCuenta = Readonly<{
  cuenta: CuentaPublica;
  /** `true`: ya se había habilitado con esta clave; no se escribió nada. */
  yaExistia: boolean;
}>;

type ErrorPropio =
  | ErrorDePlazo
  | ErrorDeLimite
  | "CLAVE_INVALIDA"
  | "CLAVE_REUTILIZADA"
  | "PARTE_NO_ENCONTRADA"
  | "YA_HABILITADA"
  | "PARTE_NO_ACTIVA"
  | "PARTE_NO_ES_CLIENTE"
  | "PARTE_SIN_CUIT_O_RAZON_SOCIAL";

export type ErrorAlHabilitarCuenta =
  ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso (red de seguridad: antes decide el dominio; los de la parte, el disparador de la base). */
const RESTRICCIONES_ADMITIDAS = [
  "PLAZO_INVALIDO",
  "LIMITE_INVALIDO",
  "PARTE_NO_ENCONTRADA",
  "YA_HABILITADA",
  "PARTE_NO_ACTIVA",
  "PARTE_NO_ES_CLIENTE",
  "PARTE_SIN_CUIT_O_RAZON_SOCIAL",
] as const;

/**
 * Habilitar a un cliente a deber (CC-1; brief PR-CC-1 §2). Contexto OPERATIVO con persona, en una transacción serializable, con el orden fijo: guard
 * (`cuenta_corriente.administrar`), la empresa opera, validación (clave, cliente, plazo y límite) e idempotencia por clave y huella:
 *  - la misma clave con el mismo pedido → la ficha ya hecha (`yaExistia: true`), sin escribir ni auditar; con otro contenido → `CLAVE_REUTILIZADA`;
 *  - el cliente ya tiene ficha (con otra clave) → `YA_HABILITADA` (una sola ficha por cliente y empresa; también la restricción única de la base, ante dos
 *    habilitaciones a la vez);
 *  - si no, se inserta y se audita `CUENTA_DEL_CLIENTE_HABILITADA` en la misma transacción. Que la parte sea un cliente activo, con CUIT y razón social
 *    lo impone el disparador de la base (una sola regla, un solo lugar): `PARTE_NO_ACTIVA`, `PARTE_NO_ES_CLIENTE`, `PARTE_SIN_CUIT_O_RAZON_SOCIAL`; una parte
 *    de otra empresa (o anonimizada) es `PARTE_NO_ENCONTRADA`.
 * El límite solo se guarda: no limita nada hasta que CC-2 lo haga cumplir al cargar una venta a cuenta.
 */
export function armarHabilitarCuentaDelCliente({
  transacciones,
  reglas,
}: DependenciasDeCuentaCorriente) {
  return async function habilitarCuentaDelCliente(
    contexto: ContextoOperativo,
    entrada: EntradaDeHabilitarCuenta,
  ): Promise<Resultado<SalidaDeHabilitarCuenta, ErrorAlHabilitarCuenta>> {
    const { empresaId } = contexto;
    const ejecutar = () =>
      transacciones.ejecutar(
        { contexto },
        async (
          tx,
        ): Promise<
          Resultado<SalidaDeHabilitarCuenta, ErrorPropio | MotivoDeRechazo | EmpresaNoOpera>
        > => {
          const previo = await prepararCaso(
            tx,
            contexto,
            reglas,
            DECLARACIONES.habilitarCuentaDelCliente.accion,
          );
          if (!previo.ok) return previo;
          const clave = exigirClave(entrada.claveDeIdempotencia);
          if (!clave.ok) return clave;
          // Un texto que no es un UUID no puede ser el id de ninguna parte: sin tocar la base.
          if (typeof entrada.parteId !== "string" || !esUuidCanonico(entrada.parteId)) {
            return err("PARTE_NO_ENCONTRADA");
          }
          const plazo = plazoValido(entrada.plazoDias);
          if (!plazo.ok) return plazo;
          const limite = limiteValido(entrada.limite);
          if (!limite.ok) return limite;

          const huella = huellaDeHabilitacion({
            parteId: entrada.parteId,
            plazoDias: plazo.valor,
            limite: limite.valor,
          });
          const previa = await tx.cuentasDeClientes.obtenerPorClave(empresaId, clave.valor);
          if (
            decidirPorHuella(previa?.huellaDeLaHabilitacion ?? null, huella) === "CLAVE_REUTILIZADA"
          ) {
            return err("CLAVE_REUTILIZADA");
          }
          if (previa !== null) return ok({ cuenta: aCuentaPublica(previa), yaExistia: true });

          const delCliente = await tx.cuentasDeClientes.obtenerPorParte(empresaId, entrada.parteId);
          if (delCliente !== null) return err("YA_HABILITADA");

          const cuenta = await tx.cuentasDeClientes.insertar({
            empresa: empresaId,
            parteId: entrada.parteId,
            plazoDias: plazo.valor,
            limite: importeATexto(limite.valor),
            claveDeIdempotencia: clave.valor,
            huella,
            habilitadaPor: previo.valor.persona,
          });
          await dejarConstancia(tx, contexto, previo.valor.persona, {
            accion: "CUENTA_DEL_CLIENTE_HABILITADA",
            entidadId: cuenta.id,
            despues: {
              parteId: cuenta.parteId,
              plazoDias: cuenta.plazoDias,
              limite: importeATexto(cuenta.limite),
              moneda: cuenta.limite.moneda,
              estado: cuenta.estado,
            },
          });
          return ok({ cuenta: aCuentaPublica(cuenta), yaExistia: false });
        },
      );
    const resultado = await repetirSiOtroGano(ejecutar, UNICAS_DE_LA_HABILITACION);
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
