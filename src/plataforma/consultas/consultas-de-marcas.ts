import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import { clavesHuerfanas } from "../../capacidades/vocabulario/vocabulario";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  estadosDeVigencia,
  hayProgramadaPendiente,
  versionVigente,
  type DefinicionDeMarca,
  type DominioGuardado,
  type EstadoDeVigencia,
  type MarcaGuardada,
  type VersionConfirmadaDeMarca,
} from "../../modulos/marcas/publico";
import { marcaComercialId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import { exigirAccionDePlataforma } from "./comun";
import type { DependenciasDeConsultasDeMarcasYPlanes } from "./contrato-de-marcas-y-planes";
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

/** Una versión confirmada de la marca, con su estado calculado a hoy. */
export type VersionDeMarcaEnFicha = Readonly<{
  numero: number;
  estado: EstadoDeVigencia;
  vigenteDesde: Date;
  motivo: string;
  reemplazaProgramada: boolean;
  confirmadaEn: Date;
  confirmadaPor: string;
  /** Lo que la versión dice POR SÍ MISMA (un campo vacío hereda de la marca padre). */
  definicion: DefinicionDeMarca;
}>;

export type DominioEnFicha = Readonly<
  Pick<
    DominioGuardado,
    "id" | "host" | "superficie" | "titular" | "estado" | "esCanonico" | "verificadoEn" | "motivo"
  >
>;

export type FichaDeMarca = Readonly<{
  marca: MarcaGuardada;
  /** El padre y el abuelo, en ese orden (vacía si no tiene padre). */
  cadena: readonly MarcaGuardada[];
  /** Las versiones confirmadas, por número ascendente. */
  versiones: readonly VersionDeMarcaEnFicha[];
  /** El borrador, con la `version` que va en `versionEsperada` de la próxima edición; `null` si no hay. */
  borrador: Readonly<{
    id: string;
    version: number;
    definicion: DefinicionDeMarca;
  }> | null;
  dominios: readonly DominioEnFicha[];
  /** Los textos del vocabulario (del borrador y de las versiones) que el catálogo del código ya no tiene: se ignoran al pintar. */
  clavesDeTextoHuerfanas: readonly string[];
}>;

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
 * La ficha de una marca (§B.11): la marca, su cadena de padres, sus versiones con el estado calculado
 * (`VIGENTE`, `PROGRAMADA`, `SIN_EFECTO`, `ANTERIOR`), su borrador, sus dominios y las claves de texto
 * huérfanas. `marcas.ver`, solo lectura.
 */
export function armarFichaDeMarca({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeMarcasYPlanes) {
  return async function fichaDeMarca(
    contexto: ContextoDePlataforma,
    entrada: Readonly<{ marcaId: string }>,
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

        const cadena: MarcaGuardada[] = [];
        let actual: MarcaGuardada = marca;
        while (actual.marcaPadreId !== null) {
          const padre: MarcaGuardada | null = await tx.marcas.obtener(actual.marcaPadreId);
          if (padre === null) break;
          cadena.push(padre);
          actual = padre;
        }

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
        return ok({
          marca,
          cadena,
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
        });
      },
    );
  };
}
