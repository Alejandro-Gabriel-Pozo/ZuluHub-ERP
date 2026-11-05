import { condicionVigente, type CondicionIibb } from "./datos-fiscales";

/**
 * Primera versión de representación que expone de Ingresos Brutos solo lo vigente (D-115/D-116, RG 1415 Anexo II A.I.a punto 4): el
 * número de inscripción (`iibbNumero`) o `iibbCondicion: "NO_CONTRIBUYENTE"`. Las tres condiciones anteriores (local, convenio
 * multilateral, exento) llegan como `null`: la vista no las imprime ni tiene que conocerlas. La 1 las trae tal cual se guardaron y
 * reimprime idéntica. Sin textos: el modelo trae el dato y la vista pone los rótulos.
 */
const PRIMERA_VERSION_CON_IIBB_VIGENTE = 2;

/** La condición de IIBB que el modelo de impresión del comprobante entrega a la vista, según su versión de representación. */
export const condicionDeIibbImpresa = (
  c: Readonly<{
    versionDeRepresentacion: number;
    emisor: Readonly<{ iibbCondicion: CondicionIibb | null }>;
  }>,
): CondicionIibb | null =>
  c.versionDeRepresentacion >= PRIMERA_VERSION_CON_IIBB_VIGENTE
    ? condicionVigente(c.emisor.iibbCondicion)
    : c.emisor.iibbCondicion;
