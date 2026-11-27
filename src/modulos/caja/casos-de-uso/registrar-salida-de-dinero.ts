import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import { decidirControl, registroDeExcepcion } from "../../../capacidades/controles/decision";
import type { ErrorDeControl } from "../../../capacidades/controles/decision";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { importeATexto, type ImporteJson } from "../../../primitivas/dinero/importe";
import { esUuidCanonico, personaId, sucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { decidirPorHuella } from "../dominio/huella";
import { exigirClave, type ErrorDeClave } from "../dominio/idempotencia-de-operacion";
import {
  categoriaAdmiteElMedio,
  decidirSalidaDeDinero,
  huellaDeLaSalidaDeDinero,
  type ErrorDeSalidaDeDinero,
} from "../dominio/movimiento-de-dinero";
import type { ErrorDeParDeCobro } from "../dominio/medios";
import type { TipoDeMedio } from "../estados";
import { origenDeSalidaPorClave, registrarEgresoEnTx } from "../egreso/egreso-por-origen";
import type { ErrorAlEgresar } from "../egreso/contrato";
import {
  dejarConstancia,
  exigirAlcance,
  prepararCaso,
  repetirSiOtroGano,
  REINTENTOS_EN_LA_SESION_DE_CAJA,
} from "./comun";
import type { DependenciasDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

/** El control de una salida sin decir quién la recibió (PR-I1): la clave vive en el catálogo de controles. */
const CONTROL_SALIDA_SIN_IDENTIFICAR = "caja.salida_sin_identificar" as const;

/**
 * Si un medio pide, además de la acción de piso del caso de uso (`movimientos_caja.registrar_manual`), la acción `salidas_de_dinero.registrar`. `false`: ninguna extra (el efectivo,
 * como hasta hoy: lo puede el operador). Es EL lugar donde se decide qué permiso pide cada medio: pasar el efectivo a gerente y administrador, o abrir otro medio al operador, es
 * cambiar una línea (decisión del dueño, 26/11/2026, «Opción B; con permisos»). Previene: que el operador saque plata por un medio que el dueño no le habilitó.
 */
const PIDE_LA_ACCION_DE_SALIDA: Readonly<Record<TipoDeMedio, boolean>> = {
  EFECTIVO: false,
  TARJETA_DEBITO: true,
  TARJETA_CREDITO: true,
  TRANSFERENCIA: true,
  QR: true,
  OTRO: true,
};

export function pideLaAccionDeSalida(tipo: TipoDeMedio): boolean {
  return PIDE_LA_ACCION_DE_SALIDA[tipo];
}

export type EntradaDeRegistrarSalidaDeDinero = Readonly<{
  /** La genera la pantalla al abrir el formulario: repetir el pedido (doble clic, reintento de red) no duplica la salida. */
  claveDeIdempotencia: string;
  cajaId: string;
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  /** Una de las categorías elegibles: la devolución de un cobro no entra por acá. */
  categoria: string;
  /** Positivo y en ARS: el egreso se guarda con signo negativo. */
  importe: ImporteJson;
  motivo: string;
  /** Quién recibió: un nombre o un empleado de la empresa, nunca los dos. `null`: no se dijo. */
  tercero: Readonly<{ nombre?: string | undefined; personaId?: string | undefined }> | null;
  referencia?: string | undefined;
  /** Controles que la persona confirmó (hoy solo `caja.salida_sin_identificar`). */
  confirmaciones?: readonly string[] | undefined;
}>;

export type SalidaDeRegistrarSalidaDeDinero = Readonly<{
  movimientoDeDineroId: string;
  movimientoId: string;
  sesionId: string;
  /** `true`: ya se había registrado con esta clave; no se escribió nada. */
  yaExistia: boolean;
  /** Salió sin decir quién recibió (y la categoría lo exigía): la lista del día lo etiqueta. */
  sinIdentificar: boolean;
}>;

type ErrorPropio =
  | ErrorDeClave
  | ErrorDeSalidaDeDinero
  | ErrorDeParDeCobro
  | ErrorAlEgresar
  | ErrorDeControl<typeof CONTROL_SALIDA_SIN_IDENTIFICAR>
  | "CAJA_NO_ENCONTRADA"
  | "CLAVE_REUTILIZADA";

export type ErrorAlRegistrarSalidaDeDinero =
  ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance | ErrorDePersistencia;

/** Restricciones que forman parte del contrato (red de seguridad: antes decide el dominio y la base las repite). */
const RESTRICCIONES_ADMITIDAS = [
  "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
  "IMPORTE_INVALIDO",
  "MOTIVO_INVALIDO",
] as const;

/** Las restricciones únicas con las que chocan dos pedidos con la misma clave a la vez: la del egreso y la del acto. */
const UNICAS_DE_LA_SALIDA = [
  "movimiento_caja_clave_uk",
  "movimiento_de_dinero_clave_uk",
  "movimiento_de_dinero_movimiento_uk",
] as const;

/**
 * Registrar que salió plata de la caja sin una compra (PR-S2; dueño 19/11 y 26/11/2026, Q-D8 A: por CUALQUIER medio activo). En UNA transacción serializable, con el
 * orden fijo: guard de la puerta (`movimientos_caja.registrar_manual` la de piso, `salidas_de_dinero.registrar` la completa), la empresa opera, la caja y el alcance de su sucursal (la sucursal sale de la caja, nunca de la pantalla),
 * clave y validación del pedido, el medio (existe) y la acción EXTRA que pide ese medio (`pideLaAccionDeSalida`), idempotencia por clave y huella (con el medio y la caja:
 * un reintento tras el cierre devuelve lo hecho; otra huella con la misma clave → `CLAVE_REUTILIZADA`), el empleado de la empresa y el control de «sin identificar»; recién
 * ahí el egreso (`registrarEgresoEnTx`: caja y jornada abiertas, medio y cuenta válidos, tipo admitido por la categoría) y el acto SALIDA. Una salida por un medio que no es
 * efectivo exige la caja abierta, como todo egreso. Egreso, acto y auditoría van juntos o no va nada; la auditoría no lleva el nombre del tercero.
 */
/**
 * Las dos puertas de la salida de dinero, con UNA implementación: la de piso (`movimientos_caja.registrar_manual`, la que tiene el operador) solo admite medios que no piden la
 * acción de salida (hoy, el efectivo: `pideLaAccionDeSalida`); la completa (`salidas_de_dinero.registrar`, gerente y administrador por defecto) admite cualquier medio.
 * Cada una declara SU acción en `DECLARACIONES`, así el guard exige exactamente lo declarado y antes de leer nada.
 */
type PuertaDeSalida = "DE_PISO" | "COMPLETA";

export function armarRegistrarSalidaDeDinero(dependencias: DependenciasDeCaja) {
  return armarPuerta(dependencias, "DE_PISO", DECLARACIONES.registrarSalidaDeDinero.accion);
}

export function armarRegistrarSalidaDeDineroPorOtroMedio(dependencias: DependenciasDeCaja) {
  return armarPuerta(
    dependencias,
    "COMPLETA",
    DECLARACIONES.registrarSalidaDeDineroPorOtroMedio.accion,
  );
}

function armarPuerta(
  { transacciones, reglas }: DependenciasDeCaja,
  puerta: PuertaDeSalida,
  accionDeLaPuerta: ClaveAccion,
) {
  return async function registrarSalidaDeDinero(
    contexto: ContextoOperativo,
    entrada: EntradaDeRegistrarSalidaDeDinero,
  ): Promise<Resultado<SalidaDeRegistrarSalidaDeDinero, ErrorAlRegistrarSalidaDeDinero>> {
    const { empresaId } = contexto;
    const ejecutar = () =>
      transacciones.ejecutar(
        { contexto, reintentos: REINTENTOS_EN_LA_SESION_DE_CAJA },
        async (
          tx,
        ): Promise<
          Resultado<
            SalidaDeRegistrarSalidaDeDinero,
            ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance
          >
        > => {
          const previo = await prepararCaso(tx, contexto, reglas, accionDeLaPuerta);
          if (!previo.ok) return previo;
          if (!esUuidCanonico(entrada.cajaId)) return err("CAJA_NO_ENCONTRADA");
          const caja = await tx.cajas.obtener(empresaId, entrada.cajaId);
          if (caja === null) return err("CAJA_NO_ENCONTRADA");
          const alcance = await exigirAlcance(tx, contexto, caja.sucursalId);
          if (!alcance.ok) return alcance;
          const clave = exigirClave(entrada.claveDeIdempotencia);
          if (!clave.ok) return clave;
          const salida = decidirSalidaDeDinero(entrada);
          if (!salida.ok) return salida;
          const armada = salida.valor;

          // El medio y la acción extra que pide su tipo: antes de decir nada de lo ya hecho (quien no puede por ese medio no ve ni la repetición).
          if (!esUuidCanonico(entrada.medioDePagoId)) return err("MEDIO_NO_ENCONTRADO");
          const medio = await tx.mediosDePago.obtener(empresaId, entrada.medioDePagoId);
          if (medio === null) return err("MEDIO_NO_ENCONTRADO");
          // La puerta de piso no admite un medio que pide la acción de salida: sin ella, el rechazo es el mismo que el del guard.
          if (puerta === "DE_PISO" && pideLaAccionDeSalida(medio.tipo)) return err("SIN_PERMISO");

          const terceroNombre = armada.tercero?.tipo === "NOMBRE" ? armada.tercero.nombre : null;
          const terceroPersona =
            armada.tercero?.tipo === "EMPLEADO" ? armada.tercero.personaId : null;
          const huella = huellaDeLaSalidaDeDinero({
            cajaId: entrada.cajaId,
            medioDePagoId: entrada.medioDePagoId,
            cuentaDeCobroId: entrada.cuentaDeCobroId,
            importe: importeATexto(armada.importe),
            categoria: armada.categoria,
            motivo: armada.motivo,
            terceroNombre,
            terceroPersonaId: terceroPersona,
            referencia: armada.referencia,
          });
          const previa = await tx.movimientosDeDinero.porClave(empresaId, clave.valor);
          const repeticion = decidirPorHuella(previa?.huella ?? null, huella);
          if (repeticion === "CLAVE_REUTILIZADA") return err("CLAVE_REUTILIZADA");
          if (previa !== null) {
            return ok({
              movimientoDeDineroId: previa.id,
              movimientoId: previa.movimientoId as string,
              sesionId: previa.sesionId,
              yaExistia: true,
              sinIdentificar:
                previa.terceroNombre === null &&
                previa.terceroPersonaId === null &&
                !armada.eximeDeTercero,
            });
          }

          if (!categoriaAdmiteElMedio(armada.categoria, medio.tipo))
            return err("MEDIO_NO_ADMITIDO");
          if (terceroPersona !== null) {
            const esMiembro = await tx.empleados.esMiembroActivo(
              empresaId,
              personaId(terceroPersona),
            );
            if (!esMiembro) return err("TERCERO_INVALIDO");
          }
          const sinIdentificar = armada.tercero === null && !armada.eximeDeTercero;
          let excepcion: ReturnType<
            typeof decidirControl<typeof CONTROL_SALIDA_SIN_IDENTIFICAR>
          > | null = null;
          if (sinIdentificar) {
            // `true`: el control no depende del plan (no hay perilla); sin configuración de la empresa nace en PERMITIR.
            const nivel = await tx.niveles.nivel(
              CONTROL_SALIDA_SIN_IDENTIFICAR,
              { empresaId, sucursalId: sucursalId(caja.sucursalId) },
              true,
            );
            excepcion = decidirControl(
              CONTROL_SALIDA_SIN_IDENTIFICAR,
              nivel,
              (entrada.confirmaciones ?? []).filter(
                (c): c is typeof CONTROL_SALIDA_SIN_IDENTIFICAR =>
                  c === CONTROL_SALIDA_SIN_IDENTIFICAR,
              ),
            );
            if (!excepcion.ok) return excepcion;
          }

          const egreso = await registrarEgresoEnTx(tx, contexto, {
            cajaId: entrada.cajaId,
            sucursalId: caja.sucursalId,
            origen: origenDeSalidaPorClave(clave.valor),
            importe: entrada.importe,
            motivo: armada.motivo,
            medio: {
              medioDePagoId: entrada.medioDePagoId,
              cuentaDeCobroId: entrada.cuentaDeCobroId,
              tiposAdmitidos: [medio.tipo],
            },
          });
          if (!egreso.ok) return egreso;
          // El egreso es de ESTE pedido (su clave sale de la del pedido): si ya existía sin acto, la base estaría rota (el acto y el egreso nacen juntos).
          if (egreso.valor.yaExistia) {
            throw new Error("invariante rota: un egreso de salida de dinero sin su acto");
          }

          const movimientoDeDineroId = await tx.movimientosDeDinero.insertar({
            empresa: empresaId,
            sucursalId: sucursalId(caja.sucursalId),
            sesionId: egreso.valor.sesionId,
            sentido: "SALIDA",
            importe: armada.importe,
            categoria: armada.categoria,
            concepto: null,
            motivo: armada.motivo,
            terceroNombre,
            terceroPersonaId: terceroPersona,
            referencia: armada.referencia,
            devuelveA: null,
            movimientoId: egreso.valor.movimientoId,
            claveDeIdempotencia: clave.valor,
            huella,
            registradoEn: contexto.ahora,
            registradoPor: previo.valor.persona,
          });
          await dejarConstancia(tx, contexto, previo.valor.persona, {
            accion: "SALIDA_DE_DINERO_REGISTRADA",
            entidad: "movimiento_de_dinero",
            entidadId: movimientoDeDineroId,
            despues: {
              sesionId: egreso.valor.sesionId,
              movimientoId: egreso.valor.movimientoId,
              categoria: armada.categoria,
              medioTipo: medio.tipo,
              importe: importeATexto(armada.importe),
              tercero: armada.tercero === null ? "NINGUNO" : armada.tercero.tipo,
            },
          });
          if (excepcion !== null && excepcion.ok) {
            const registro = registroDeExcepcion(excepcion.valor, {
              entidad: "movimiento_de_dinero",
              entidadId: movimientoDeDineroId,
            });
            await dejarConstancia(tx, contexto, previo.valor.persona, {
              accion: registro.accion,
              entidad: "movimiento_de_dinero",
              entidadId: registro.entidadId,
              despues: registro.despues,
            });
          }
          return ok({
            movimientoDeDineroId,
            movimientoId: egreso.valor.movimientoId,
            sesionId: egreso.valor.sesionId,
            yaExistia: false,
            sinIdentificar,
          });
        },
      );
    const resultado = await repetirSiOtroGano(ejecutar, UNICAS_DE_LA_SALIDA);
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
