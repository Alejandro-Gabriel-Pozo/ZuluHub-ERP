import type { Mensaje } from "../../modulos/fiscal/publico";
import { textoSeguro } from "./saneamiento";
import { camino, desescaparXml, hijosDe, leerXml, textoDe, type NodoXml } from "./xml";

/**
 * Lectura de las respuestas de WSAA y WSFE a datos tipados, SIN decidir nada: qué significan (autorizado,
 * rechazado, incierto) es de `clasificar.ts`. Valor puro. Todo lo que ARCA manda es texto: acá solo se
 * ubica cada campo por su camino exacto (`Envelope > Body > <operación>Response > <operación>Result`) y se
 * devuelve como texto. Un campo que falta (o que no es un texto) es el texto vacío, igual que un elemento
 * vacío (`<CAE />`): para quien clasifica son lo mismo, un valor que no sirve. Una respuesta ilegible o con
 * una estructura que no es la de la operación es `null`.
 *
 * Los caminos son los de las respuestas REALES de homologación (espía F0), que en dos puntos difieren del
 * manual WSFE v4.8: el detalle de `FECAESolicitar` es `FECAEDetResponse` (el manual dice `FEDetResponse`) y
 * las observaciones son `Observaciones > Obs` (el manual dice `Obs > Observaciones`). Por eso se leen TODOS
 * los hijos de `FeDetResp` y de `Observaciones`, sin depender del nombre de cada uno.
 */

const CODIGO_DE_MENSAJE = /^[0-9]{1,6}$/;

/** El cuerpo SOAP de la respuesta de una operación: `Envelope > Body > <operación>Response > <operación>Result`. */
function resultadoDeOperacion(cuerpo: string, operacion: string): NodoXml | null {
  const xml = leerXml(cuerpo);
  // Stryker disable next-line ConditionalExpression: sin el corte, el error no trae `valor` y todo da null igual
  if (!xml.ok) return null;
  const resultado = camino(
    xml.valor,
    "Envelope",
    "Body",
    `${operacion}Response`,
    `${operacion}Result`,
  );
  // Un `Result` vacío (`<xResult/>`) es un texto vacío: no es la estructura de una respuesta.
  return typeof resultado === "object" ? resultado : null;
}

/** El texto de un campo; `""` si falta o no es un texto (un elemento vacío, `<CAE />`, también es `""`). */
const campo = (nodo: NodoXml | undefined, nombre: string): string =>
  textoDe(camino(nodo, nombre)) ?? "";

/** Un mensaje `{ Code, Msg }` de ARCA, o `null` si no tiene esa forma. El texto sale saneado y acotado. */
function leerMensaje(nodo: NodoXml): Mensaje | null {
  const codigo = campo(nodo, "Code");
  const texto = textoDe(camino(nodo, "Msg"));
  if (texto === null || !CODIGO_DE_MENSAJE.test(codigo)) return null;
  return { codigo: Number(codigo), texto: textoSeguro(desescaparXml(texto)) };
}

/**
 * Los mensajes de un contenedor (`Errors`, `Observaciones`): todos sus hijos, cualquiera sea su etiqueta
 * (`Err`, `Obs`). `null` si algún hijo no tiene `Code` y `Msg`: la respuesta no se entiende.
 */
function leerMensajes(contenedor: NodoXml | undefined): readonly Mensaje[] | null {
  const mensajes = hijosDe(contenedor).map(leerMensaje);
  return mensajes.includes(null) ? null : (mensajes as Mensaje[]);
}

// ---------------------------------------------------------------------------------------------------------------
// WSAA
// ---------------------------------------------------------------------------------------------------------------

/** Una falla SOAP (`Envelope > Body > Fault`): el código sin interpretar y el texto saneado. */
export type FallaSoap = Readonly<{ codigo: string; texto: string }>;

/** La falla SOAP de una respuesta, o `null` si no es una (o no se puede leer). */
export function leerFallaSoap(cuerpo: string): FallaSoap | null {
  const xml = leerXml(cuerpo);
  // Stryker disable next-line ConditionalExpression: sin el corte, el error no trae `valor` y todo da null igual
  if (!xml.ok) return null;
  const falla = camino(xml.valor, "Envelope", "Body", "Fault");
  const codigo = campo(falla, "faultcode");
  if (codigo === "") return null;
  return { codigo, texto: textoSeguro(desescaparXml(campo(falla, "faultstring"))) };
}

/**
 * El ticket de `loginCms`: `loginCmsReturn` trae el `loginTicketResponse` COMO TEXTO ESCAPADO, que se
 * desescapa y se lee de nuevo. El ticket queda como texto (`token`, `sign`) y su vencimiento en texto ISO.
 */
export type TicketLeido = Readonly<{ token: string; sign: string; vencimiento: string }>;

export function leerTicketDeLoginCms(cuerpo: string): TicketLeido | null {
  const externo = leerXml(cuerpo);
  // Stryker disable next-line ConditionalExpression: sin el corte, el error no trae `valor` y todo da null igual
  if (!externo.ok) return null;
  const retorno = textoDe(
    camino(externo.valor, "Envelope", "Body", "loginCmsResponse", "loginCmsReturn"),
  );
  if (retorno === null) return null;
  const interno = leerXml(desescaparXml(retorno));
  // Stryker disable next-line ConditionalExpression: sin el corte, el error no trae `valor` y todo da null igual
  if (!interno.ok) return null;
  const ticket = camino(interno.valor, "loginTicketResponse");
  const token = campo(camino(ticket, "credentials"), "token");
  const sign = campo(camino(ticket, "credentials"), "sign");
  const vencimiento = campo(camino(ticket, "header"), "expirationTime");
  if (token === "" || sign === "" || vencimiento === "") return null;
  return { token, sign, vencimiento };
}

// ---------------------------------------------------------------------------------------------------------------
// WSFE
// ---------------------------------------------------------------------------------------------------------------

/** Los errores del resultado (`Errors > Err`): todos los hijos, o `null` si alguno no se entiende. */
const leerErrores = (resultado: NodoXml): readonly Mensaje[] | null =>
  leerMensajes(camino(resultado, "Errors"));

export type UltimoAutorizadoLeido = Readonly<{
  errores: readonly Mensaje[];
  puntoDeVenta: string;
  tipoDeComprobante: string;
  numero: string;
}>;

export function leerUltimoAutorizado(cuerpo: string): UltimoAutorizadoLeido | null {
  const resultado = resultadoDeOperacion(cuerpo, "FECompUltimoAutorizado");
  if (resultado === null) return null;
  const errores = leerErrores(resultado);
  if (errores === null) return null;
  return {
    errores,
    puntoDeVenta: campo(resultado, "PtoVta"),
    tipoDeComprobante: campo(resultado, "CbteTipo"),
    numero: campo(resultado, "CbteNro"),
  };
}

/** Un comprobante del detalle de `FECAESolicitar` (`FeDetResp`), con cada campo como texto. */
export type DetalleDeAutorizacionLeido = Readonly<{
  resultado: string;
  desde: string;
  hasta: string;
  fecha: string;
  codigo: string;
  vencimiento: string;
  observaciones: readonly Mensaje[];
}>;

export type AutorizacionLeida = Readonly<{
  errores: readonly Mensaje[];
  /** El `Resultado` de `FeCabResp` (`""` si falta), o `null` si la respuesta no trae `FeCabResp`. */
  cabecera: Readonly<{ resultado: string }> | null;
  detalles: readonly DetalleDeAutorizacionLeido[];
}>;

export function leerAutorizacion(cuerpo: string): AutorizacionLeida | null {
  const resultado = resultadoDeOperacion(cuerpo, "FECAESolicitar");
  if (resultado === null) return null;
  const errores = leerErrores(resultado);
  if (errores === null) return null;
  const cabecera = camino(resultado, "FeCabResp");
  const detalles: DetalleDeAutorizacionLeido[] = [];
  for (const nodo of hijosDe(camino(resultado, "FeDetResp"))) {
    const observaciones = leerMensajes(camino(nodo, "Observaciones"));
    if (observaciones === null) return null;
    detalles.push({
      resultado: campo(nodo, "Resultado"),
      desde: campo(nodo, "CbteDesde"),
      hasta: campo(nodo, "CbteHasta"),
      fecha: campo(nodo, "CbteFch"),
      codigo: campo(nodo, "CAE"),
      vencimiento: campo(nodo, "CAEFchVto"),
      observaciones,
    });
  }
  return {
    errores,
    cabecera: typeof cabecera === "object" ? { resultado: campo(cabecera, "Resultado") } : null,
    detalles,
  };
}

/** Una alícuota de `Iva` de una consulta: su `Id` de ARCA y los dos importes, como texto. */
export type AlicuotaLeida = Readonly<{ id: string; base: string; importe: string }>;

/** Un comprobante asociado de una nota (`CbtesAsoc > CbteAsoc`), como texto. */
export type AsociadoLeido = Readonly<{
  tipoDeComprobante: string;
  puntoDeVenta: string;
  numero: string;
  cuit: string;
  fecha: string;
}>;

/** `ResultGet` de `FECompConsultar`: lo que ARCA tiene registrado de un número, todo como texto. */
export type ComprobanteConsultadoLeido = Readonly<{
  puntoDeVenta: string;
  tipoDeComprobante: string;
  desde: string;
  hasta: string;
  fecha: string;
  tipoDeDocumento: string;
  numeroDeDocumento: string;
  moneda: string;
  total: string;
  neto: string;
  iva: string;
  alicuotas: readonly AlicuotaLeida[];
  asociados: readonly AsociadoLeido[];
  resultado: string;
  codigo: string;
  vencimiento: string;
}>;

export type ConsultaLeida = Readonly<{
  errores: readonly Mensaje[];
  /** `null` si no hay `ResultGet` (ARCA contesta con errores, por ejemplo 602). */
  comprobante: ComprobanteConsultadoLeido | null;
}>;

export function leerConsulta(cuerpo: string): ConsultaLeida | null {
  const resultado = resultadoDeOperacion(cuerpo, "FECompConsultar");
  if (resultado === null) return null;
  const errores = leerErrores(resultado);
  if (errores === null) return null;
  const datos = camino(resultado, "ResultGet");
  if (typeof datos !== "object") return { errores, comprobante: null };
  return {
    errores,
    comprobante: {
      puntoDeVenta: campo(datos, "PtoVta"),
      tipoDeComprobante: campo(datos, "CbteTipo"),
      desde: campo(datos, "CbteDesde"),
      hasta: campo(datos, "CbteHasta"),
      fecha: campo(datos, "CbteFch"),
      tipoDeDocumento: campo(datos, "DocTipo"),
      numeroDeDocumento: campo(datos, "DocNro"),
      moneda: campo(datos, "MonId"),
      total: campo(datos, "ImpTotal"),
      neto: campo(datos, "ImpNeto"),
      iva: campo(datos, "ImpIVA"),
      alicuotas: hijosDe(camino(datos, "Iva")).map((a) => ({
        id: campo(a, "Id"),
        base: campo(a, "BaseImp"),
        importe: campo(a, "Importe"),
      })),
      asociados: hijosDe(camino(datos, "CbtesAsoc")).map((a) => ({
        tipoDeComprobante: campo(a, "Tipo"),
        puntoDeVenta: campo(a, "PtoVta"),
        numero: campo(a, "Nro"),
        cuit: campo(a, "Cuit"),
        fecha: campo(a, "CbteFch"),
      })),
      resultado: campo(datos, "Resultado"),
      codigo: campo(datos, "CodAutorizacion"),
      vencimiento: campo(datos, "FchVto"),
    },
  };
}

/** Una fila de una tabla de `FEParamGet*`: cada campo (`Id`, `Desc`, `FchDesde`...) como texto. */
export type FilaDeParametro = Readonly<Record<string, string>>;

export type TablaLeida = Readonly<{
  errores: readonly Mensaje[];
  filas: readonly FilaDeParametro[];
}>;

/**
 * Las filas de una tabla: TODOS los hijos de `ResultGet`, cualquiera sea el nombre de su etiqueta (cada
 * tabla usa el suyo). Una fila es un objeto cuyos campos de texto se conservan; otra cosa no es una fila.
 */
export function leerTabla(cuerpo: string, operacion: string): TablaLeida | null {
  const resultado = resultadoDeOperacion(cuerpo, operacion);
  if (resultado === null) return null;
  const errores = leerErrores(resultado);
  if (errores === null) return null;
  const contenedor = camino(resultado, "ResultGet");
  // Una tabla es un `ResultGet` con filas (un objeto) o vacío; sin `ResultGet` solo si ARCA contestó con errores.
  const esTabla =
    contenedor === "" ||
    (typeof contenedor === "object" && !Array.isArray(contenedor)) ||
    (contenedor === undefined && errores.length > 0);
  if (!esTabla) return null;
  const filas: FilaDeParametro[] = [];
  for (const nodo of hijosDe(contenedor)) {
    if (typeof nodo === "string") return null;
    const campos = Object.entries(nodo as { readonly [nombre: string]: NodoXml }).flatMap(
      ([nombre, valor]): [string, string][] => (typeof valor === "string" ? [[nombre, valor]] : []),
    );
    filas.push(Object.fromEntries(campos));
  }
  return { errores, filas };
}

/** `FEDummy`: el estado de los tres servidores de ARCA, como texto (`OK`; `""` si falta). */
export type EstadoDelServicioLeido = Readonly<{
  aplicacion: string;
  baseDeDatos: string;
  autenticacion: string;
}>;

export function leerDummy(cuerpo: string): EstadoDelServicioLeido | null {
  const resultado = resultadoDeOperacion(cuerpo, "FEDummy");
  if (resultado === null) return null;
  return {
    aplicacion: campo(resultado, "AppServer"),
    baseDeDatos: campo(resultado, "DbServer"),
    autenticacion: campo(resultado, "AuthServer"),
  };
}
