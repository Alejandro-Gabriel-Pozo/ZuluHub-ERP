/**
 * Respuestas de ARCA CONSTRUIDAS A PARTIR DEL MANUAL, NO GRABADAS. Para las operaciones que no tienen una grabación real del espía
 * (`test/utilidades/arca-grabaciones/`) y solo se conocen por el manual WSFE v4.8 (`Pedernal-docs/12-referencias-externas/
 * arca-manuales-del-dueno/WSFE_manual_RG-4291_v4-8.md`). Lo que dicen estas pruebas es «el lector entiende lo que el manual describe»,
 * NO «ARCA contesta así»: los literales que el manual no da (por ejemplo los valores de `EmisionTipo`, o qué manda ARCA en `FchBaja`
 * cuando no hay baja) son ejemplos, y están SIN VERIFICAR contra ARCA real.
 */

/** Un `PtoVenta` de `FEParamGetPtosVenta` (manual l. 3046-3114). Un campo en `undefined` no se escribe (los opcionales faltan). */
export type PtoVentaDelManual = Readonly<{
  Nro?: string | undefined;
  EmisionTipo?: string | undefined;
  Bloqueado?: string | undefined;
  FchBaja?: string | undefined;
}>;

const elemento = (nombre: string, valor: string | undefined): string =>
  valor === undefined ? "" : `<${nombre}>${valor}</${nombre}>`;

/**
 * La respuesta de `FEParamGetPtosVenta` con la estructura del manual (l. 3046-3096): `Envelope > Body > FEParamGetPtosVentaResponse >
 * FEParamGetPtosVentaResult > ResultGet > PtoVenta*` y, si ARCA contesta con errores, `Errors > Err > Code, Msg`. Con `puntos` en
 * `undefined` no hay `ResultGet` (el manual lo marca como no obligatorio).
 */
export function respuestaDePtosVentaDelManual(
  opciones: Readonly<{
    puntos?: readonly PtoVentaDelManual[];
    errores?: readonly Readonly<{ codigo: number; texto: string }>[];
  }> = {},
): string {
  const resultGet =
    opciones.puntos === undefined
      ? ""
      : `<ResultGet>${opciones.puntos
          .map(
            (p) =>
              `<PtoVenta>${elemento("Nro", p.Nro)}${elemento("EmisionTipo", p.EmisionTipo)}` +
              `${elemento("Bloqueado", p.Bloqueado)}${elemento("FchBaja", p.FchBaja)}</PtoVenta>`,
          )
          .join("")}</ResultGet>`;
  const errores =
    opciones.errores === undefined
      ? ""
      : `<Errors>${opciones.errores
          .map((e) => `<Err><Code>${e.codigo}</Code><Msg>${e.texto}</Msg></Err>`)
          .join("")}</Errors>`;
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>` +
    `<FEParamGetPtosVentaResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FEParamGetPtosVentaResult>` +
    `${resultGet}${errores}</FEParamGetPtosVentaResult></FEParamGetPtosVentaResponse></soap:Body></soap:Envelope>`
  );
}
