import { emailDeContactoDesdeTexto } from "../../../primitivas/contacto/email";
import { telefonoDesdeTexto } from "../../../primitivas/contacto/telefono";
import {
  domicilioDesdeDatos,
  type DatosDeDomicilio,
  type Domicilio,
} from "../../../primitivas/domicilio/domicilio";
import { domicilioLibreDesdeTexto } from "../../../primitivas/domicilio/domicilio-libre";
import {
  esCondicionIva,
  type CondicionIva,
} from "../../../primitivas/identificacion-fiscal/condicion-iva";
import { paisDesdeTexto } from "../../../primitivas/identificacion-fiscal/pais";
import { nombreODenominacionDesdeTexto } from "../../../primitivas/texto/nombre-o-razon-social";
import { textoDeUnaLineaDesdeTexto } from "../../../primitivas/texto/texto-de-una-linea";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import {
  documentoDeParteDesdeDatos,
  type DatosDeDocumento,
  type DocumentoDeParte,
} from "./documento";
import { esNaturalezaDeParte, type NaturalezaDeParte } from "./estados";

/**
 * Los datos de una parte del directorio, validados campo por campo (E9 §3.1). Cada campo opcional vacío (ausente, `null` o en blanco) queda `null`.
 * Devuelve TODOS los errores de una vez, uno por campo, para que la pantalla los marque juntos. Las reglas de forma de cada dato viven en su
 * primitiva (`nombre-o-razon-social.ts`, `email.ts`, `telefono.ts`, `domicilio.ts`, `domicilio-libre.ts`, `condicion-iva.ts`); acá solo están los dos
 * largos que ninguna primitiva tiene (apellido y alias, 100, y la nota, 2000: los del DDL de `clientes.md` Anexo C) y la regla de qué admite cada
 * naturaleza.
 */
export const LARGO_MAXIMO_DEL_APELLIDO_DE_PARTE = 100;
export const LARGO_MAXIMO_DEL_ALIAS_DE_PARTE = 100;
export const LARGO_MAXIMO_DE_LA_NOTA_DE_PARTE = 2000;

/** Un domicilio argentino (estructurado) o del exterior (una línea de texto). */
export type DomicilioDeParteEntrada = Readonly<{
  pais: string;
  estructurado?: DatosDeDomicilio | null;
  texto?: string | null;
}>;

export type EntradaDeParte = Readonly<{
  naturaleza: string;
  nombre: string;
  apellido?: string | null;
  alias?: string | null;
  documento?: DatosDeDocumento | null;
  condicionIva?: string | null;
  email?: string | null;
  telefono?: string | null;
  domicilio?: DomicilioDeParteEntrada | null;
  nota?: string | null;
}>;

export type DomicilioDeParte =
  Readonly<{ pais: "AR"; estructurado: Domicilio }> | Readonly<{ pais: string; texto: string }>;

export type DatosDeParte = Readonly<{
  naturaleza: NaturalezaDeParte;
  nombre: string;
  apellido: string | null;
  alias: string | null;
  documento: DocumentoDeParte | null;
  condicionIva: CondicionIva | null;
  email: string | null;
  telefono: string | null;
  domicilio: DomicilioDeParte | null;
  nota: string | null;
}>;

export type CampoDeParte =
  | "naturaleza"
  | "nombre"
  | "apellido"
  | "alias"
  | "documento"
  | "condicionIva"
  | "email"
  | "telefono"
  | "domicilio"
  | "nota";

export type ErrorDeCampoDeParte = Readonly<{ campo: CampoDeParte; codigo: string }>;

/** Recorta; lo ausente, nulo o en blanco es `null`. */
function opcional(valor: string | null | undefined): string | null {
  const limpio = valor?.trim() ?? "";
  return limpio === "" ? null : limpio;
}

export function validarDatosDeParte(
  entrada: EntradaDeParte,
): Resultado<DatosDeParte, readonly ErrorDeCampoDeParte[]> {
  const errores: ErrorDeCampoDeParte[] = [];
  const falla = (campo: CampoDeParte, codigo: string): null => {
    errores.push({ campo, codigo });
    return null;
  };

  if (!esNaturalezaDeParte(entrada.naturaleza)) {
    return err([{ campo: "naturaleza", codigo: "NATURALEZA_INVALIDA" }]);
  }
  const naturaleza = entrada.naturaleza;

  const nombreValido = nombreODenominacionDesdeTexto(entrada.nombre);
  // Stryker disable next-line StringLiteral: el valor inicial nunca se lee: si el nombre no es válido hay un error y se devuelve `err` antes de armar los datos.
  let nombre = "";
  if (nombreValido.ok) {
    nombre = nombreValido.valor;
  } else {
    falla("nombre", nombreValido.error === "VACIO" ? "NOMBRE_REQUERIDO" : "NOMBRE_INVALIDO");
  }

  let apellido: string | null = null;
  const apellidoTexto = opcional(entrada.apellido);
  if (apellidoTexto !== null) {
    if (naturaleza === "JURIDICA") {
      falla("apellido", "APELLIDO_SOLO_DE_PERSONA");
    } else {
      const valido = textoDeUnaLineaDesdeTexto(apellidoTexto, {
        maximo: LARGO_MAXIMO_DEL_APELLIDO_DE_PARTE,
        exigirUnaLetra: true,
      });
      apellido = valido.ok ? valido.valor : falla("apellido", "APELLIDO_INVALIDO");
    }
  }

  let alias: string | null = null;
  const aliasTexto = opcional(entrada.alias);
  if (aliasTexto !== null) {
    const valido = textoDeUnaLineaDesdeTexto(aliasTexto, {
      maximo: LARGO_MAXIMO_DEL_ALIAS_DE_PARTE,
      exigirUnaLetra: true,
    });
    alias = valido.ok ? valido.valor : falla("alias", "ALIAS_INVALIDO");
  }

  let documento: DocumentoDeParte | null = null;
  if (entrada.documento !== undefined && entrada.documento !== null) {
    const valido = documentoDeParteDesdeDatos(naturaleza, entrada.documento);
    documento = valido.ok ? valido.valor : falla("documento", valido.error);
  }

  let condicionIva: CondicionIva | null = null;
  const condicionTexto = opcional(entrada.condicionIva);
  if (condicionTexto !== null) {
    condicionIva = esCondicionIva(condicionTexto)
      ? condicionTexto
      : falla("condicionIva", "CONDICION_IVA_INVALIDA");
  }

  let email: string | null = null;
  const emailTexto = opcional(entrada.email);
  if (emailTexto !== null) {
    const valido = emailDeContactoDesdeTexto(emailTexto);
    email = valido.ok ? valido.valor : falla("email", "EMAIL_INVALIDO");
  }

  let telefono: string | null = null;
  const telefonoTexto = opcional(entrada.telefono);
  if (telefonoTexto !== null) {
    const valido = telefonoDesdeTexto(telefonoTexto);
    telefono = valido.ok ? valido.valor : falla("telefono", "TELEFONO_INVALIDO");
  }

  let domicilio: DomicilioDeParte | null = null;
  if (entrada.domicilio !== undefined && entrada.domicilio !== null) {
    domicilio = domicilioDeEntrada(entrada.domicilio, falla);
  }

  let nota: string | null = null;
  const notaTexto = opcional(entrada.nota);
  if (notaTexto !== null) {
    const valida = textoDeUnaLineaDesdeTexto(notaTexto, {
      maximo: LARGO_MAXIMO_DE_LA_NOTA_DE_PARTE,
      exigirUnaLetra: false,
    });
    nota = valida.ok ? valida.valor : falla("nota", "NOTA_INVALIDA");
  }

  if (errores.length > 0) return err(errores);
  return ok({
    naturaleza,
    nombre,
    apellido,
    alias,
    documento,
    condicionIva,
    email,
    telefono,
    domicilio,
    nota,
  });
}

function domicilioDeEntrada(
  entrada: DomicilioDeParteEntrada,
  falla: (campo: CampoDeParte, codigo: string) => null,
): DomicilioDeParte | null {
  const pais = paisDesdeTexto(entrada.pais);
  if (!pais.ok) return falla("domicilio", "PAIS_INVALIDO");
  if (pais.valor === "AR") {
    if (
      entrada.estructurado === undefined ||
      entrada.estructurado === null ||
      opcional(entrada.texto) !== null
    ) {
      return falla("domicilio", "DOMICILIO_INVALIDO");
    }
    const valido = domicilioDesdeDatos(entrada.estructurado);
    return valido.ok
      ? { pais: "AR", estructurado: valido.valor }
      : falla("domicilio", "DOMICILIO_INVALIDO");
  }
  if (entrada.estructurado !== undefined && entrada.estructurado !== null) {
    return falla("domicilio", "DOMICILIO_INVALIDO");
  }
  const libre = domicilioLibreDesdeTexto(entrada.texto ?? null);
  if (!libre.ok || libre.valor === null) return falla("domicilio", "DOMICILIO_INVALIDO");
  return { pais: pais.valor, texto: libre.valor };
}
