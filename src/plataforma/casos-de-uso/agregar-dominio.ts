import type { ContextoDePlataforma } from "../../contexto/contexto";
import {
  decidirAltaDeDominio,
  traducirErroresDeDominio,
  type DominioPorAgregar,
  type ErrorDeAltaDeDominio,
} from "../../modulos/marcas/publico";
import {
  empresaId,
  marcaComercialId,
  type DominioId,
} from "../../primitivas/identificadores/marca";
import { ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { DeclaracionDeAccionDePlataforma } from "../consultas/declaraciones";
import { uuidDesdeTexto } from "../dominio/soporte/consulta";
import {
  datosDeAuditoriaDeDominio,
  ejecutarCasoDeDominios,
  type DependenciasDeDominios,
  type ErrorComunDeDominios,
} from "./dominios-comun";

/** La operación con la que se guarda la clave de idempotencia (la tabla exige `^[a-z_.]+$`). */
export const OPERACION_AGREGAR_DOMINIO = "dominios.agregar";

/** El caso de uso y la acción que exige al guard (cruce X1 de ADR-003). */
export const DECLARACION_DE_AGREGAR_DOMINIO = {
  accion: "dominios.agregar",
} as const satisfies DeclaracionDeAccionDePlataforma;

/** Quién será el dueño del host: una marca (host compartido) o una empresa (host dedicado). */
export type DuenioAAgregar =
  Readonly<{ tipo: "MARCA"; marcaId: string }> | Readonly<{ tipo: "EMPRESA"; empresaId: string }>;

export type EntradaDeAgregarDominio = Readonly<{
  /** Identifica el pedido: repetirlo con la misma clave devuelve lo mismo SIN registrar otro host ni otra constancia. */
  claveDeIdempotencia: string;
  /** El nombre de host tal como lo escribió la persona; se normaliza (minúsculas, sin puerto ni punto final). */
  host: string;
  superficie: string;
  titular: string;
  /** El host que arma los enlaces de la marca para esa superficie; solo en hosts de marca. */
  esCanonico: boolean;
  duenio: DuenioAAgregar;
}>;

export type SalidaDeAgregarDominio = Readonly<{
  dominioId: DominioId;
  /** `true` cuando esta llamada repite una anterior con la misma clave: no registró nada nuevo. */
  yaExistia: boolean;
}>;

/** Los motivos de la base que este caso admite: el host, el canónico, la marca y la empresa dueñas. */
const MOTIVOS_QUE_ADMITE = [
  "HOST_INVALIDO",
  "SUPERFICIE_INVALIDA",
  "TITULAR_INVALIDO",
  "SUPERFICIE_NO_ADMITIDA_PARA_EMPRESA",
  "CANONICO_SOLO_DE_MARCA",
  "HOST_DUPLICADO",
  "YA_TIENE_CANONICO",
  "MARCA_NO_ENCONTRADA",
  "MARCA_RETIRADA",
  "EMPRESA_NO_ENCONTRADA",
] as const;

export type ErrorAlAgregarDominio =
  ErrorComunDeDominios | ErrorDeAltaDeDominio | "ID_INVALIDO" | (typeof MOTIVOS_QUE_ADMITE)[number];

type Duenio = DominioPorAgregar["duenio"];

function validarDuenio(duenio: DuenioAAgregar): Resultado<Duenio, "ID_INVALIDO"> {
  if (duenio.tipo === "MARCA") {
    const id = uuidDesdeTexto(duenio.marcaId);
    return id.ok ? ok({ tipo: "MARCA", marcaId: marcaComercialId(id.valor) }) : id;
  }
  const id = uuidDesdeTexto(duenio.empresaId);
  return id.ok ? ok({ tipo: "EMPRESA", empresaId: empresaId(id.valor) }) : id;
}

/**
 * Agregar un dominio (M4a). Contexto de PLATAFORMA, solo ADMIN. Registra el host normalizado de una marca
 * o de una empresa, con su superficie y su titular; nace PENDIENTE_VERIFICACION y sirve la página neutra
 * hasta que se verifique y se active. La marca y la empresa dueñas, el host libre y el canónico libre los
 * confirma la base en la misma transacción (un host retirado puede registrarse de nuevo). Deja la
 * constancia `DOMINIO_AGREGADO` con el actor del contexto. Repetir con la misma clave devuelve el mismo
 * dominio con `yaExistia: true`; dos altas del mismo host a la vez: una gana y la otra es `HOST_DUPLICADO`.
 */
export function armarAgregarDominio(dependencias: DependenciasDeDominios) {
  return async function agregarDominio(
    contexto: ContextoDePlataforma,
    entrada: EntradaDeAgregarDominio,
  ): Promise<Resultado<SalidaDeAgregarDominio, ErrorAlAgregarDominio>> {
    const resultado = await ejecutarCasoDeDominios<
      SalidaDeAgregarDominio,
      DominioPorAgregar,
      ErrorDeAltaDeDominio | "ID_INVALIDO"
    >(dependencias, {
      contexto,
      accion: DECLARACION_DE_AGREGAR_DOMINIO.accion,
      operacion: OPERACION_AGREGAR_DOMINIO,
      claveDeIdempotencia: entrada.claveDeIdempotencia,
      validar: () => {
        const duenio = validarDuenio(entrada.duenio);
        if (!duenio.ok) return duenio;
        const alta = decidirAltaDeDominio({
          host: entrada.host,
          superficie: entrada.superficie,
          titular: entrada.titular,
          esCanonico: entrada.esCanonico,
          duenio: duenio.valor,
        });
        if (!alta.ok) return alta;
        const a = alta.valor;
        return ok({
          // La huella lleva lo ya normalizado: el mismo host escrito distinto es el mismo pedido.
          entrada: {
            host: a.host,
            superficie: a.superficie,
            titular: a.titular,
            esCanonico: a.esCanonico,
            duenioTipo: a.duenio.tipo,
            duenioId: a.duenio.tipo === "MARCA" ? a.duenio.marcaId : a.duenio.empresaId,
          },
          valor: a,
        });
      },
      trabajar: async (tx, alta) => {
        const creado = await tx.dominios.crear(alta);
        return ok({
          salida: { dominioId: creado.id, yaExistia: false },
          constancia: {
            accion: "DOMINIO_AGREGADO",
            entidad: "dominio",
            entidadId: creado.id,
            antes: null,
            despues: {
              ...datosDeAuditoriaDeDominio(creado),
              titular: creado.titular,
              esCanonico: creado.esCanonico,
              duenioTipo: creado.duenio.tipo,
              duenioId:
                creado.duenio.tipo === "MARCA" ? creado.duenio.marcaId : creado.duenio.empresaId,
              marcaId: creado.marcaId,
            },
          },
        });
      },
      comoRepeticion: (guardado) => ({ ...guardado, yaExistia: true }),
    });
    return traducirErroresDeDominio(resultado, MOTIVOS_QUE_ADMITE);
  };
}
