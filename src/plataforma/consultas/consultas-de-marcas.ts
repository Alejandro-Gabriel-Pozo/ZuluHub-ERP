import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import { clavesHuerfanas } from "../../capacidades/vocabulario/vocabulario";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  contrastesDelTema,
  decidirConfirmacionDeMarca,
  definicionDeLaUltimaDecision,
  estadosDeVigencia,
  hayProgramadaPendiente,
  resolverConOrigen,
  versionVigente,
  type DefinicionConOrigen,
  type EstadoDeVigencia,
  type MarcaGuardada,
  type OrigenEnLaCadena,
  type VersionConfirmadaDeMarca,
} from "../../modulos/marcas/publico";
import { marcaComercialId, type PlanId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import {
  ancestrosConDefinicion,
  comoPlanPorDefecto,
  planConSuUltimaVersion,
  type AncestroConDefinicion,
  type PlanConSuUltimaVersion,
} from "../casos-de-uso/cadena-de-marca";
import { aplanarError } from "../casos-de-uso/marcas-y-planes-comun";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import { exigirAccionDePlataforma } from "./comun";
import type {
  DefinicionEfectivaDeMarca,
  DependenciasDeConsultasDeMarcasYPlanes,
  EntradaDeFichaDeMarca,
  FichaDeMarca,
  OrigenDeCampo,
  PuedeConfirmarse,
  VersionDeMarcaEnFicha,
} from "./contrato-de-marcas-y-planes";
import { DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES as D } from "./declaraciones-de-marcas-y-planes";

const LECTURA = { aislamiento: "read committed", soloLectura: true } as const;

/** Una marca en la lista: lo que hace falta para elegirla y saber en qué anda. */
export type MarcaEnLista = Readonly<{
  marca: MarcaGuardada;
  /** El nombre visible de la versión vigente; `null` si todavía no tiene versión vigente. */
  nombreVisible: string | null;
  /** El número de la versión vigente; `null` si ninguna rige todavía (la marca no se resuelve). */
  versionVigente: number | null;
  hayBorrador: boolean;
  /** Hay una versión confirmada que todavía no empezó. */
  hayProgramada: boolean;
}>;

export type VistaDeListaDeMarcas = Readonly<{ marcas: readonly MarcaEnLista[] }>;

export type ErrorAlListarMarcas = MotivoDeRechazo | ErrorDePersistencia;

/** Las marcas, por código, con su versión vigente y si tienen borrador o algo programado (§B.11). `marcas.ver`, solo lectura. */
export function armarListarMarcas({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeMarcasYPlanes) {
  return async function listarMarcas(
    contexto: ContextoDePlataforma,
  ): Promise<Resultado<VistaDeListaDeMarcas, ErrorAlListarMarcas>> {
    return transacciones.ejecutar(
      { contexto, ...LECTURA },
      async (tx): Promise<Resultado<VistaDeListaDeMarcas, MotivoDeRechazo>> => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.listarMarcas.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        const marcas = await tx.marcas.listar();
        const ids = marcas.map((m) => m.id);
        const confirmadas = await tx.marcas.confirmadasDeLasMarcas(ids);
        const borradores = await tx.marcas.borradoresDeLasMarcas(ids);
        return ok({
          marcas: marcas.map((marca) => {
            const propias = confirmadas.filter((v) => v.marcaId === marca.id);
            const vigente = versionVigente(propias, contexto.ahora);
            return {
              marca,
              nombreVisible: vigente === null ? null : vigente.definicion.nombreVisible,
              versionVigente: vigente === null ? null : vigente.numero,
              hayBorrador: borradores.some((b) => b.marcaId === marca.id),
              hayProgramada: hayProgramadaPendiente(propias, contexto.ahora),
            };
          }),
        });
      },
    );
  };
}

export type ErrorAlVerFichaDeMarca =
  MotivoDeRechazo | "ID_INVALIDO" | "MARCA_NO_ENCONTRADA" | ErrorDePersistencia;

const enFicha = (
  version: VersionConfirmadaDeMarca,
  estado: EstadoDeVigencia,
): VersionDeMarcaEnFicha => ({
  numero: version.numero,
  estado,
  vigenteDesde: version.vigenteDesde,
  motivo: version.motivo,
  reemplazaProgramada: version.reemplazaProgramada,
  confirmadaEn: version.confirmadaEn,
  confirmadaPor: version.confirmadaPor,
  definicion: version.definicion,
});

/**
 * Lo que se pasa a `decidirConfirmacionDeMarca` para PREVER la confirmación: un pedido que no puede fallar
 * por lo que el formulario va a escribir (motivo no vacío, vigencia desde ahora, reemplazando lo programado),
 * de modo que el resultado dependa solo de la definición. Ver `PuedeConfirmarse`.
 */
const MOTIVO_DE_LA_PREVISION = "previsión de la confirmación";

/** La definición efectiva en la forma del contrato: los eslabones de la herencia pasan a ser la marca de la que sale cada campo. */
function comoEfectiva(
  conOrigen: DefinicionConOrigen,
  ancestros: readonly AncestroConDefinicion[],
  planes: ReadonlyMap<PlanId, PlanConSuUltimaVersion>,
): DefinicionEfectivaDeMarca {
  const { resuelta, aspecto, origenes } = conOrigen;
  const origen = (o: OrigenEnLaCadena): OrigenDeCampo => {
    if (o.tipo !== "heredado") return o;
    // El eslabón 0 es la propia definición; el 1, el padre; el 2, el abuelo.
    const ancestro = ancestros[o.eslabon - 1];
    if (ancestro === undefined) throw new RangeError(`el eslabón ${o.eslabon} no tiene ancestro`);
    return { tipo: "heredado", marcaId: ancestro.marca.id, marcaCodigo: ancestro.marca.codigo };
  };
  const plan =
    resuelta.planPorDefectoId === null ? undefined : planes.get(resuelta.planPorDefectoId);
  return {
    nombreVisible: { valor: resuelta.nombreVisible, origen: origen(origenes.nombreVisible) },
    tema: {
      primary: { valor: resuelta.tema.primary ?? null, origen: origen(origenes.tema.primary) },
      "on-primary": {
        valor: resuelta.tema["on-primary"] ?? null,
        origen: origen(origenes.tema["on-primary"]),
      },
      secondary: {
        valor: resuelta.tema.secondary ?? null,
        origen: origen(origenes.tema.secondary),
      },
      accent: { valor: resuelta.tema.accent ?? null, origen: origen(origenes.tema.accent) },
    },
    aspecto: {
      estilo: { valor: aspecto.estilo, origen: origen(origenes.aspecto.estilo) },
      superficie: { valor: aspecto.superficie, origen: origen(origenes.aspecto.superficie) },
      esquinas: { valor: aspecto.esquinas, origen: origen(origenes.aspecto.esquinas) },
      titulos: { valor: aspecto.titulos, origen: origen(origenes.aspecto.titulos) },
      ingreso: { valor: aspecto.ingreso, origen: origen(origenes.aspecto.ingreso) },
    },
    logo: { valor: resuelta.logo, origen: origen(origenes.logo) },
    vocabulario: (Object.keys(resuelta.vocabulario) as (keyof typeof resuelta.vocabulario)[])
      .sort()
      .map((texto) => ({
        texto,
        valor: resuelta.vocabulario[texto] as string,
        origen: origen(origenes.vocabulario[texto] as OrigenEnLaCadena),
      })),
    modulosIniciales: {
      valor: resuelta.modulosIniciales,
      origen: origen(origenes.modulosIniciales),
    },
    planPorDefecto: {
      valor:
        plan === undefined
          ? null
          : {
              planId: plan.plan.id,
              codigo: plan.plan.codigo,
              estado: plan.plan.estado,
              ultimaVersion:
                plan.ultimaPublicada === null
                  ? null
                  : {
                      versionDePlanId: plan.ultimaPublicada.id,
                      numero: plan.ultimaPublicada.numero,
                      nombreComercial: plan.ultimaPublicada.nombreComercial,
                    },
            },
      origen: origen(origenes.planPorDefecto),
    },
  };
}

/**
 * La ficha de una marca (§B.11): la marca, su cadena de padres, sus versiones con el estado calculado
 * (`VIGENTE`, `PROGRAMADA`, `SIN_EFECTO`, `ANTERIOR`), su borrador, sus dominios y las claves de texto
 * huérfanas, y lo que la consola necesita para decidir: la definición EFECTIVA de lo que rige y la del
 * borrador (con el origen de cada campo), la de la ÚLTIMA versión confirmada (la base del primer borrador),
 * si el borrador se puede confirmar y cómo quedan los contrastes de
 * color. `marcas.ver`, solo lectura.
 *
 * La herencia sale de `resolverDefinicion` (vía `resolverConOrigen`) sobre LA MISMA cadena que valida
 * `confirmarVersionDeMarca` (`ancestrosConDefinicion`): lo que se ve es lo que se valida. Esa cadena no se
 * corta ante un ancestro retirado y la del alta sí (ver `cadena-de-marca.ts`).
 */
export function armarFichaDeMarca({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeMarcasYPlanes) {
  return async function fichaDeMarca(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeFichaDeMarca,
  ): Promise<Resultado<FichaDeMarca, ErrorAlVerFichaDeMarca>> {
    return transacciones.ejecutar(
      { contexto, ...LECTURA },
      async (tx): Promise<Resultado<FichaDeMarca, ErrorAlVerFichaDeMarca>> => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.fichaDeMarca.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        const id = uuidDesdeTexto(entrada.marcaId);
        if (!id.ok) return id;
        const marca = await tx.marcas.obtener(marcaComercialId(id.valor));
        if (marca === null) return err("MARCA_NO_ENCONTRADA");

        const ancestros = await ancestrosConDefinicion(tx, marca, contexto.ahora);
        const definicionesDeLosAncestros = ancestros.map((a) => a.definicion);
        const confirmadas = await tx.marcas.confirmadasDe(marca.id);
        const borrador = await tx.marcas.borradorDe(marca.id);
        const dominios = await tx.marcas.dominiosDeLaMarca(marca.id);
        const estados = new Map(
          estadosDeVigencia(
            confirmadas.map((v) => ({ numero: v.numero, vigenteDesde: v.vigenteDesde })),
            contexto.ahora,
          ).map((v) => [v.numero, v.estado] as const),
        );
        const vocabularios = [
          ...confirmadas.map((v) => v.definicion.vocabulario),
          ...(borrador === null ? [] : [borrador.definicion.vocabulario]),
        ];

        // Lo que rige hoy y lo que regiría el borrador, cada uno con su origen por campo.
        const vigente = versionVigente(confirmadas, contexto.ahora);
        const deLaVigente =
          vigente === null
            ? null
            : resolverConOrigen([vigente.definicion, ...definicionesDeLosAncestros]);
        const delBorrador =
          borrador === null
            ? null
            : resolverConOrigen([borrador.definicion, ...definicionesDeLosAncestros]);
        // La última decisión (mayor número, regida o programada): la MISMA regla y la misma función que usa
        // `guardarBorradorDeMarca` para armar el primer borrador, así lo que la consola ofrece como base es lo que se guarda.
        const definicionDeLaUltima = definicionDeLaUltimaDecision(confirmadas);
        const ultima =
          definicionDeLaUltima === null
            ? null
            : (confirmadas.find((v) => v.definicion === definicionDeLaUltima) ?? null);
        if (definicionDeLaUltima !== null && ultima === null) {
          throw new RangeError("la última decisión no está entre las versiones confirmadas");
        }
        const deLaUltima =
          ultima === null
            ? null
            : resolverConOrigen([ultima.definicion, ...definicionesDeLosAncestros]);

        // Los planes por defecto que esas dos definiciones nombran (a lo sumo tres, a menudo el mismo), leídos una vez.
        const planes = new Map<PlanId, PlanConSuUltimaVersion>();
        for (const conOrigen of [deLaVigente, delBorrador, deLaUltima]) {
          const planId = conOrigen?.resuelta.planPorDefectoId ?? null;
          if (planId === null || planes.has(planId)) continue;
          const leido = await planConSuUltimaVersion(tx, planId);
          if (leido !== null) planes.set(planId, leido);
        }

        // ¿Se podría confirmar el borrador? Es la MISMA decisión que la confirmación, sin escribir.
        let puedeConfirmarse: PuedeConfirmarse = { ok: false, error: "SIN_BORRADOR" };
        if (borrador !== null && delBorrador !== null) {
          const idDelPlan = delBorrador.resuelta.planPorDefectoId;
          const leido = idDelPlan === null ? undefined : planes.get(idDelPlan);
          const decision = aplanarError(
            decidirConfirmacionDeMarca({
              borrador: borrador.definicion,
              ancestros: definicionesDeLosAncestros,
              versiones: confirmadas,
              planPorDefecto: leido === undefined ? null : comoPlanPorDefecto(leido),
              pedido: {
                vigenteDesde: contexto.ahora,
                motivo: MOTIVO_DE_LA_PREVISION,
                reemplazaProgramada: true,
              },
              ahora: contexto.ahora,
            }),
          );
          puedeConfirmarse = decision.ok ? { ok: true } : decision;
        }

        return ok({
          marca,
          cadena: ancestros.map((a) => a.marca),
          versiones: confirmadas.map((v) => enFicha(v, estados.get(v.numero) ?? "ANTERIOR")),
          borrador:
            borrador === null
              ? null
              : { id: borrador.id, version: borrador.version, definicion: borrador.definicion },
          dominios: dominios.map((d) => ({
            id: d.id,
            host: d.host,
            superficie: d.superficie,
            titular: d.titular,
            estado: d.estado,
            esCanonico: d.esCanonico,
            verificadoEn: d.verificadoEn,
            motivo: d.motivo,
          })),
          clavesDeTextoHuerfanas: [...new Set(vocabularios.flatMap(clavesHuerfanas))].sort(),
          efectiva: deLaVigente === null ? null : comoEfectiva(deLaVigente, ancestros, planes),
          ultimaConfirmada:
            ultima === null || deLaUltima === null
              ? null
              : {
                  numero: ultima.numero,
                  vigenteDesde: ultima.vigenteDesde,
                  definicion: ultima.definicion,
                  efectiva: comoEfectiva(deLaUltima, ancestros, planes),
                },
          borradorEfectivo:
            delBorrador === null ? null : comoEfectiva(delBorrador, ancestros, planes),
          puedeConfirmarse,
          contraste:
            delBorrador === null
              ? null
              : contrastesDelTema(delBorrador.resuelta.tema, delBorrador.aspecto.superficie),
        });
      },
    );
  };
}
