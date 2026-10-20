import { textoDeAjuste } from "../../capacidades/planes/valores";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  decidirAjuste,
  traducirErroresDePlanes,
  type ErrorDeAjuste,
} from "../../modulos/planes/publico";
import {
  empresaId as comoEmpresaId,
  tenantId as comoTenantId,
  type EmpresaId,
  type TenantId,
} from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { Dato } from "../../puertos/sin-secretos";
import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import {
  validarLargoDelMotivo,
  validarNumeroEsperado,
  validarVigencia,
} from "../dominio/formas-de-entrada";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import {
  aplanarError,
  auditarEnLasEmpresas,
  ejecutarCasoDeMarcasYPlanes,
  esDato,
  instanteISO,
  type DependenciasDeMarcasYPlanes,
  type ErrorComunDeMarcasYPlanes,
  type ErrorPlano,
} from "./marcas-y-planes-comun";
import { datosDelValorDePerilla } from "./datos-de-planes";

/** La operación con la que se guarda la clave de idempotencia (la tabla exige `^[a-z_.]+$`). */
export const OPERACION_AJUSTAR_PERILLA = "perillas.ajustar";

/** El caso de uso y la acción que exige al guard (cruce X1 de ADR-003). */
export const DECLARACION_DE_AJUSTAR_PERILLA = {
  accion: "perillas.ajustar",
} as const satisfies DeclaracionDeAccionDePlataforma;

export type EntradaDeAjustarPerilla = Readonly<{
  /** Identifica el pedido: repetirlo con la misma clave devuelve lo mismo SIN ajustar otra vez ni auditar de nuevo. */
  claveDeIdempotencia: string;
  tenantId: string;
  /** `null`: el ajuste es de todo el tenant; si no, de esa empresa (una perilla de ámbito TENANT no se ajusta por empresa). */
  empresaId: string | null;
  perilla: string;
  /**
   * El valor nuevo: `"DEL_PLAN"` (vuelve al valor del plan), `{ tipo: "INTERRUPTOR", encendida }` o
   * `{ tipo: "LIMITE", limite }` con `limite` un entero de 0 a 999999999 o `"ILIMITADO"`. Llega sin tipar y
   * se valida contra la perilla.
   */
  valor: unknown;
  /** Desde cuándo rige. No puede ser retroactivo (se tolera un minuto de reloj). */
  vigenteDesde: Date;
  motivo: string;
  /**
   * El número del último ajuste de ESTA perilla en ESTE alcance (el tenant, o la empresa) que vio quien
   * decide, o `null` si no había ninguno. Si otra persona ajustó entretanto, `VERSION_DESACTUALIZADA`.
   */
  numeroEsperado: number | null;
  /** Hay un ajuste programado que este deja sin efecto: hay que decirlo (`CAMBIO_PROGRAMADO_PENDIENTE`). */
  reemplazaProgramada: boolean;
}>;

export type SalidaDeAjustarPerilla = Readonly<{
  /** El número del ajuste dentro de su serie (perilla y alcance). */
  numero: number;
}>;

/** Los motivos de la base que este caso admite: la segunda barrera ante una carrera. */
const MOTIVOS_QUE_ADMITE = [
  "TENANT_NO_ENCONTRADO",
  "EMPRESA_NO_ENCONTRADA",
  "EMPRESA_DE_OTRO_TENANT",
  "VERSION_DESACTUALIZADA",
  "VIGENCIA_RETROACTIVA",
  "MOTIVO_OBLIGATORIO",
] as const;

type ErrorPropio =
  | ErrorDeAjuste
  | "ID_INVALIDO"
  | "NUMERO_ESPERADO_INVALIDO"
  | "VIGENCIA_INVALIDA"
  | "MOTIVO_DEMASIADO_LARGO"
  | "TENANT_NO_ENCONTRADO"
  | "EMPRESA_NO_ENCONTRADA"
  | "EMPRESA_DE_OTRO_TENANT";

export type ErrorAlAjustarPerilla = ErrorPlano<
  ErrorComunDeMarcasYPlanes | ErrorPropio | (typeof MOTIVOS_QUE_ADMITE)[number]
>;

type Pedido = Readonly<{
  tenantId: TenantId;
  empresaId: EmpresaId | null;
  perilla: string;
  valor: unknown;
  vigenteDesde: Date;
  motivo: string;
  numeroEsperado: number | null;
  reemplazaProgramada: boolean;
}>;

/**
 * Ajustar una perilla de un cliente (M5). Contexto de PLATAFORMA, solo ADMIN. Es el extra (o la excepción)
 * que paga un cliente: reemplaza el valor del plan para todo su tenant o para una empresa, desde una fecha,
 * y `DEL_PLAN` vuelve al valor del plan. Solo inserción, con «la última decisión manda»: se corrige con
 * otro ajuste. Sobrevive al cambio de plan. No se puede encender una perilla cuya requerida está apagada
 * (`PERILLA_REQUIERE_OTRA`). Deja la constancia `PERILLA_AJUSTADA` (con el valor efectivo de antes) y una
 * en la auditoría de CADA empresa afectada (actor nulo). Dos ajustes de la misma perilla y alcance desde
 * el mismo `numeroEsperado`: uno gana y el otro es `VERSION_DESACTUALIZADA`.
 */
export function armarAjustarPerilla(dependencias: DependenciasDeMarcasYPlanes) {
  return async function ajustarPerilla(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeAjustarPerilla,
  ): Promise<Resultado<SalidaDeAjustarPerilla, ErrorAlAjustarPerilla>> {
    const resultado = await ejecutarCasoDeMarcasYPlanes<
      SalidaDeAjustarPerilla,
      Pedido,
      ErrorPropio
    >(dependencias, {
      contexto,
      accion: DECLARACION_DE_AJUSTAR_PERILLA.accion,
      operacion: OPERACION_AJUSTAR_PERILLA,
      claveDeIdempotencia: entrada.claveDeIdempotencia,
      validar: () => {
        const tenant = uuidDesdeTexto(entrada.tenantId);
        if (!tenant.ok) return tenant;
        let empresa: string | null = null;
        if (entrada.empresaId !== null) {
          const id = uuidDesdeTexto(entrada.empresaId);
          if (!id.ok) return id;
          empresa = id.valor;
        }
        const vigencia = validarVigencia(entrada.vigenteDesde);
        if (!vigencia.ok) return vigencia;
        const motivo = validarLargoDelMotivo(entrada.motivo);
        if (!motivo.ok) return motivo;
        const numero = validarNumeroEsperado(entrada.numeroEsperado);
        if (!numero.ok) return numero;
        return ok({
          entrada: {
            tenantId: tenant.valor,
            empresaId: empresa,
            perilla: entrada.perilla,
            // Lo que no es un dato plano no puede ser un valor válido: la huella lo marca y el dominio lo rechaza.
            valor: esDato(entrada.valor) ? entrada.valor : "<valor-que-no-es-dato>",
            vigenteDesde: instanteISO(vigencia.valor),
            motivo: motivo.valor.trim(),
            numeroEsperado: numero.valor,
            reemplazaProgramada: entrada.reemplazaProgramada,
          },
          valor: {
            tenantId: comoTenantId(tenant.valor),
            empresaId: empresa === null ? null : comoEmpresaId(empresa),
            perilla: entrada.perilla,
            valor: entrada.valor,
            vigenteDesde: vigencia.valor,
            motivo: motivo.valor,
            numeroEsperado: numero.valor,
            reemplazaProgramada: entrada.reemplazaProgramada,
          },
        });
      },
      trabajar: async (tx, pedido) => {
        if (!(await tx.planes.existeElTenant(pedido.tenantId))) return err("TENANT_NO_ENCONTRADO");
        if (pedido.empresaId !== null) {
          const delTenant = await tx.planes.tenantDeLaEmpresa(pedido.empresaId);
          if (delTenant === null) return err("EMPRESA_NO_ENCONTRADA");
          if (delTenant !== pedido.tenantId) return err("EMPRESA_DE_OTRO_TENANT");
        }

        // El valor efectivo AHORA de cada perilla en este alcance: sin él no se sabe si la requerida está encendida.
        const derechos =
          pedido.empresaId === null
            ? await tx.derechos.delTenant(contexto, pedido.tenantId)
            : await tx.derechos.deLaEmpresaParaLaPlataforma(contexto, pedido.empresaId);
        // El tenant y la empresa existen (se vieron recién): sin derechos no hay nada que calcular.
        if (derechos === null) throw new RangeError("no se pudieron leer los derechos del alcance");

        const serie = await tx.planes.serieDeAjustes(
          pedido.tenantId,
          pedido.empresaId,
          pedido.perilla,
        );
        const decision = decidirAjuste(dependencias.catalogoDePerillas, serie, {
          ahora: contexto.ahora,
          perilla: pedido.perilla,
          empresaId: pedido.empresaId,
          valor: pedido.valor,
          vigenteDesde: pedido.vigenteDesde,
          motivo: pedido.motivo,
          numeroEsperado: pedido.numeroEsperado,
          reemplazaProgramada: pedido.reemplazaProgramada,
          valoresActuales: derechos.perillas,
        });
        if (!decision.ok) return decision;

        const ajuste = await tx.planes.ajustar({
          tenantId: pedido.tenantId,
          empresaId: pedido.empresaId,
          perilla: pedido.perilla,
          numero: decision.valor.numero,
          valor: textoDeAjuste(decision.valor.valor),
          vigenteDesde: pedido.vigenteDesde,
          reemplazaProgramada: pedido.reemplazaProgramada,
          motivo: decision.valor.motivo,
        });

        const efectivo = derechos.perillas.get(pedido.perilla);
        const antes: Record<string, Dato> =
          efectivo === undefined
            ? {}
            : {
                perilla: pedido.perilla,
                origen: efectivo.origen,
                ...datosDelValorDePerilla(efectivo),
              };
        const nuevo = decision.valor.valor;
        const constancia = {
          accion: "PERILLA_AJUSTADA",
          entidad: "ajuste_de_perilla",
          entidadId: ajuste.id,
          antes,
          despues: {
            tenantId: pedido.tenantId,
            empresaId: pedido.empresaId,
            perilla: pedido.perilla,
            numero: ajuste.numero,
            ...(nuevo === "DEL_PLAN"
              ? { delPlan: true, tipo: null, encendida: null, limite: null }
              : { delPlan: false, ...datosDelValorDePerilla(nuevo) }),
            vigenteDesde: instanteISO(ajuste.vigenteDesde),
            motivo: ajuste.motivo,
            reemplazaProgramada: ajuste.reemplazaProgramada,
            reemplazadas: [...decision.valor.reemplazadas],
          },
        } as const;
        // Lo que afecta a una empresa deja además su constancia: en la empresa del ajuste, o en todas las del tenant.
        const afectadas =
          pedido.empresaId === null
            ? await tx.planes.empresasDelTenant(pedido.tenantId)
            : [pedido.empresaId];
        await auditarEnLasEmpresas(tx, afectadas, constancia);
        return ok({ salida: { numero: ajuste.numero }, constancias: [constancia] });
      },
      comoRepeticion: (guardado) => guardado,
    });
    return aplanarError(traducirErroresDePlanes(resultado, MOTIVOS_QUE_ADMITE));
  };
}
