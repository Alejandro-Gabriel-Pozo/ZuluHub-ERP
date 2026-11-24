import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import {
  TIPOS_DE_DOCUMENTO_DE_IDENTIDAD,
  type TipoDeDocumentoDeIdentidad,
} from "../../../../../src/primitivas/identificacion-fiscal/documento";
import { PROVINCIAS } from "../../../../../src/primitivas/domicilio/provincias";
import { CLAVE_DE_CONDICION, CLAVE_DE_DOCUMENTO } from "../facturacion/modelo-de-emision";
import {
  RUTA_DE_CLIENTES,
  puede,
  type AccionesParaLaPantalla,
  type FichaDeParte,
  type Opcion,
  type RolDelFiltro,
} from "./modelo-de-directorio";

/**
 * El modelo de vista del formulario de «Clientes y proveedores» (alta y ficha; maqueta aprobada `directorio.html`, función `vForm`), aparte de `modelo-de-directorio.ts` (lista y filtros)
 * para que ningún archivo pase el tope de largo. Puro: sin React ni servidor. Los textos salen del catálogo; no se arma ningún texto nuevo, solo se eligen los aprobados.
 *
 *  - **Tipos de documento:** persona, los cinco de la primitiva; empresa, solo CUIT. «ID extranjero» no se ofrece (no tiene texto aprobado). Una prueba los compara con el dominio.
 *  - **«(opcional)» como la maqueta:** lo llevan Apellido, Alias, Número del documento, Condición frente al IVA, Email, Teléfono, Calle, Número de la calle, Código postal, Localidad,
 *    Provincia y Nota; no lo llevan Persona/Empresa, Nombre o Razón social, Tipo de documento ni País.
 *  - **Permisos:** todo lo que no sea exactamente `true` cierra (solo ofrece o apaga botones: el servidor decide).
 */

type Naturaleza = "HUMANA" | "JURIDICA";

/** Los tipos de documento que se ofrecen: una persona, los cinco de la primitiva; una empresa, solo CUIT. Una prueba los compara con el dominio. */
export const TIPOS_DE_DOCUMENTO_OFRECIDOS: Readonly<
  Record<Naturaleza, readonly TipoDeDocumentoDeIdentidad[]>
> = {
  HUMANA: TIPOS_DE_DOCUMENTO_DE_IDENTIDAD,
  JURIDICA: ["CUIT"],
};

const CONDICIONES = Object.keys(CLAVE_DE_CONDICION) as readonly (keyof typeof CLAVE_DE_CONDICION)[];

type CampoArmado = Readonly<{ etiqueta: string; valorInicial: string }>;

export type FormularioDeParteArmado = Readonly<{
  /** El título de la pantalla: «Nuevo» en el alta; el nombre de la parte al editar. */
  titulo: string;
  naturaleza: Readonly<{ etiqueta: string; valorInicial: Naturaleza; opciones: readonly Opcion[] }>;
  nombre: Readonly<{ etiquetaDePersona: string; etiquetaDeEmpresa: string; valorInicial: string }>;
  apellido: CampoArmado;
  alias: CampoArmado;
  documentoTipo: Readonly<{
    etiqueta: string;
    valorInicial: string;
    /** Las opciones por naturaleza (la empresa solo CUIT). */
    opciones: Readonly<Record<Naturaleza, readonly Opcion[]>>;
    /** El tipo que ya tiene la parte no se ofrece (por ejemplo «ID extranjero»): el selector sale con la opción vacía para no cambiarlo en silencio. */
    conOpcionVacia: boolean;
  }>;
  documentoNumero: CampoArmado;
  documentoPais: CampoArmado;
  condicionIva: Readonly<CampoArmado & { opciones: readonly Opcion[] }>;
  email: CampoArmado;
  telefono: CampoArmado;
  domicilio: string;
  calle: CampoArmado;
  numero: CampoArmado;
  codigoPostal: CampoArmado;
  localidad: CampoArmado;
  provincia: Readonly<CampoArmado & { opciones: readonly Opcion[] }>;
  roles: Readonly<{
    titulo: string;
    cliente: Readonly<{ etiqueta: string; valorInicial: boolean }>;
    proveedor: Readonly<{ etiqueta: string; valorInicial: boolean }>;
  }>;
  nota: CampoArmado;
  textos: Readonly<{ sinElegir: string; guardarIgual: string; posiblesDuplicados: string }>;
  guardar: string;
  volver: Readonly<{ href: string; etiqueta: string }>;
  /** Si el servidor deja guardar hoy: si no, «Guardar» sale apagado (solo una ayuda: el guard decide). */
  puedeGuardar: boolean;
  /** «Desactivar» o «Reactivar» (solo al editar); `null` en el alta. */
  estado: Readonly<{ texto: string; reactivar: boolean; apagado: boolean }> | null;
}>;

/** El rótulo de un campo opcional como la maqueta: el rótulo, un espacio y «(opcional)». */
const opcional = (rotulo: string, d: DiccionarioResuelto): string =>
  `${rotulo} ${texto(d, "catalogo.campo.opcional")}`;

/** El nombre de la parte tal como lo arma la lista: persona «Apellido, Nombre» si hay apellido; empresa, el nombre. */
export function nombreDeLaFicha(ficha: FichaDeParte): string {
  const nombre = ficha.nombre ?? "";
  if (ficha.naturaleza === "JURIDICA") return nombre;
  return ficha.apellido === null || ficha.apellido === "" ? nombre : `${ficha.apellido}, ${nombre}`;
}

/**
 * El formulario: para una parte nueva, en blanco con la naturaleza «Persona» y el tipo CUIT (el primero de la maqueta); con `rolInicial`, la casilla de ese rol nace tildada (se llega desde
 * el filtro de proveedores o de clientes). Para editar, con los datos de la ficha.
 */
export function armarElFormularioDeParte(
  ficha: FichaDeParte | null,
  puedeEnLaPantalla: AccionesParaLaPantalla,
  rolInicial: "" | RolDelFiltro = "",
  d: DiccionarioResuelto = {},
): FormularioDeParteArmado {
  const naturaleza: Naturaleza = ficha?.naturaleza ?? "HUMANA";
  const opcionesDeDocumento = (n: Naturaleza): readonly Opcion[] =>
    TIPOS_DE_DOCUMENTO_OFRECIDOS[n].map((t) => ({
      valor: t,
      etiqueta: texto(d, CLAVE_DE_DOCUMENTO[t]),
    }));
  const tipoGuardado = ficha?.documento?.tipo ?? null;
  const tipoOfrecido =
    tipoGuardado !== null &&
    (TIPOS_DE_DOCUMENTO_OFRECIDOS[naturaleza] as readonly string[]).includes(tipoGuardado);
  const guardar = ficha === null ? puede(puedeEnLaPantalla.crear) : puede(puedeEnLaPantalla.editar);
  const alternar = ficha !== null && ficha.activa;
  return {
    titulo: ficha === null ? texto(d, "clientes.lista.nuevo") : nombreDeLaFicha(ficha),
    naturaleza: {
      // SUPUESTO (DEC-0837): el selector (decisión del dueño, DDD:294) necesita un rótulo y la maqueta no dibuja ninguno; se arma con sus dos palabras aprobadas, «Persona / Empresa» como lo nombró el dueño. Costo de revertir: una línea.
      etiqueta: `${texto(d, "clientes.lista.persona")} / ${texto(d, "clientes.lista.empresa")}`,
      valorInicial: naturaleza,
      opciones: [
        { valor: "HUMANA", etiqueta: texto(d, "clientes.lista.persona") },
        { valor: "JURIDICA", etiqueta: texto(d, "clientes.lista.empresa") },
      ],
    },
    nombre: {
      etiquetaDePersona: texto(d, "catalogo.dato.nombre"),
      etiquetaDeEmpresa: texto(d, "clientes.lista.razon_social"),
      valorInicial: ficha?.nombre ?? "",
    },
    apellido: {
      etiqueta: opcional(texto(d, "clientes.formulario.apellido"), d),
      valorInicial: ficha?.apellido ?? "",
    },
    alias: {
      etiqueta: opcional(texto(d, "fiscal.pantalla.config_cert_alias"), d),
      valorInicial: ficha?.alias ?? "",
    },
    documentoTipo: {
      etiqueta: texto(d, "clientes.formulario.tipo_de_documento"),
      valorInicial: tipoGuardado === null ? "CUIT" : tipoOfrecido ? tipoGuardado : "",
      opciones: {
        HUMANA: opcionesDeDocumento("HUMANA"),
        JURIDICA: opcionesDeDocumento("JURIDICA"),
      },
      conOpcionVacia: tipoGuardado !== null && !tipoOfrecido,
    },
    documentoNumero: {
      etiqueta: opcional(texto(d, "salon.texto.admin_numero"), d),
      valorInicial: ficha?.documento?.numero ?? "",
    },
    documentoPais: {
      etiqueta: texto(d, "clientes.formulario.pais"),
      valorInicial: ficha?.documento?.pais ?? "",
    },
    condicionIva: {
      etiqueta: opcional(texto(d, "clientes.lista.condicion_frente_al_iva"), d),
      valorInicial: ficha?.condicionIva ?? "",
      opciones: CONDICIONES.map((c) => ({ valor: c, etiqueta: texto(d, CLAVE_DE_CONDICION[c]) })),
    },
    email: {
      etiqueta: opcional(texto(d, "clientes.formulario.email"), d),
      valorInicial: ficha?.email ?? "",
    },
    telefono: {
      etiqueta: opcional(texto(d, "sucursal.telefono"), d),
      valorInicial: ficha?.telefono ?? "",
    },
    domicilio: texto(d, "fiscal.pantalla.config_df_domicilio_fiscal"),
    calle: {
      etiqueta: opcional(texto(d, "fiscal.pantalla.config_pv_calle"), d),
      valorInicial: ficha?.domicilio?.calle ?? "",
    },
    numero: {
      etiqueta: opcional(texto(d, "fiscal.pantalla.config_pv_numero_de_calle"), d),
      valorInicial: ficha?.domicilio?.numero ?? "",
    },
    codigoPostal: {
      etiqueta: opcional(texto(d, "fiscal.pantalla.config_pv_codigo_postal"), d),
      valorInicial: ficha?.domicilio?.codigoPostal ?? "",
    },
    localidad: {
      etiqueta: opcional(texto(d, "fiscal.pantalla.config_pv_localidad"), d),
      valorInicial: ficha?.domicilio?.localidad ?? "",
    },
    provincia: {
      etiqueta: opcional(texto(d, "fiscal.pantalla.config_pv_provincia"), d),
      valorInicial: ficha?.domicilio?.provincia ?? "",
      opciones: PROVINCIAS.map((p) => ({ valor: p.codigo, etiqueta: p.nombre })),
    },
    roles: {
      titulo: texto(d, "clientes.formulario.roles"),
      cliente: {
        etiqueta: texto(d, "fiscal.pantalla.rotulo_cliente"),
        valorInicial: ficha === null ? rolInicial === "cliente" : ficha.roles.includes("CUSTOMER"),
      },
      proveedor: {
        etiqueta: texto(d, "compras.compra.proveedor"),
        valorInicial:
          ficha === null ? rolInicial === "proveedor" : ficha.roles.includes("PROVEEDOR"),
      },
    },
    nota: {
      etiqueta: opcional(texto(d, "clientes.formulario.nota"), d),
      valorInicial: ficha?.nota ?? "",
    },
    textos: {
      sinElegir: texto(d, "catalogo.dato.sin_elegir"),
      guardarIgual: texto(d, "clientes.lista.guardar_igual"),
      posiblesDuplicados: texto(d, "clientes.lista.posibles_duplicados"),
    },
    guardar: texto(d, "catalogo.accion.guardar"),
    volver: { href: RUTA_DE_CLIENTES, etiqueta: texto(d, "catalogo.seccion.volver_a_la_lista") },
    puedeGuardar: guardar,
    estado:
      ficha === null
        ? null
        : {
            texto: texto(d, alternar ? "clientes.lista.desactivar" : "clientes.lista.reactivar"),
            reactivar: !alternar,
            apagado: !puede(alternar ? puedeEnLaPantalla.desactivar : puedeEnLaPantalla.reactivar),
          },
  };
}
