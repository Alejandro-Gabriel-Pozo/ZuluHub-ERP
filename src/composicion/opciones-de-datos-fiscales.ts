import { CONDICIONES_DE_IVA, type CondicionIva } from "../modulos/fiscal/publico";

/**
 * Las listas cerradas que la pantalla de Datos fiscales ofrece (D-43). Son datos fijos del código: no leen la base, no dependen de la
 * empresa y no hay nada que autorizar. Si la persona puede abrir la pantalla lo decide `permisosDelActor`; esto es solo qué opciones
 * muestra.
 *
 * Condición frente al IVA del emisor: las tres que hoy admite el dominio (`CONDICIONES_DE_IVA` de fiscal), en ese orden, con el texto
 * que el dueño confirmó el 2026-10-29 (D-44 de `facturador-contratos-de-pantalla.md`, repositorio de documentos (github.com/Alejandro-Gabriel-Pozo/ZuluHub-docs)): los de la tabla
 * «Condición Frente al IVA del receptor» del manual WSFE v4.8 (`12-referencias-externas/arca-manuales-del-dueno/WSFE_manual_RG-4291_v4-8.md`,
 * l. 5717, 5718 y 5720), que ARCA contestó igual en homologación (`test/utilidades/arca-grabaciones/corrida1/016-FEParamGetCondicionIvaReceptor-respuesta-http200.xml`).
 * Que el emisor solo pueda tener esas tres es un supuesto del diseño no verificado (D-44, `emisor.ts`).
 *
 * Condición de Ingresos Brutos: NO HAY lista. D-45 dejó Ingresos Brutos fuera de la primera versión de la pantalla mientras no haya una
 * fuente verificable de sus condiciones; las del dominio (`CONDICIONES_DE_IIBB`: local, convenio multilateral, exento) son un supuesto
 * del diseño. Se suma acá cuando el dueño apruebe la fuente, no antes.
 *
 * Previene: que dos pantallas escriban a mano el mismo texto con otra redacción («Monotributo» en una, «Responsable Monotributo» en otra),
 * o que una condición nueva del dominio llegue a la pantalla sin texto aprobado (el `Record` no compila sin él).
 */
const TEXTO_DE_LA_CONDICION_DE_IVA: Readonly<Record<CondicionIva, string>> = {
  RESPONSABLE_INSCRIPTO: "IVA Responsable Inscripto",
  MONOTRIBUTO: "Responsable Monotributo",
  EXENTO: "IVA Sujeto Exento",
};

export type OpcionDeCondicionDeIva = Readonly<{ valor: CondicionIva; texto: string }>;

export type OpcionesDeDatosFiscales = Readonly<{
  condicionesDeIva: readonly OpcionDeCondicionDeIva[];
}>;

/** Las opciones cerradas de la pantalla de Datos fiscales. Pura: cada llamada devuelve una lista nueva. */
export function opcionesDeDatosFiscales(): OpcionesDeDatosFiscales {
  return {
    condicionesDeIva: CONDICIONES_DE_IVA.map((valor) => ({
      valor,
      texto: TEXTO_DE_LA_CONDICION_DE_IVA[valor],
    })),
  };
}
