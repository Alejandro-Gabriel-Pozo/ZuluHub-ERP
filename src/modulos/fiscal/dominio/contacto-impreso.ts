import { enlaceDeLaWeb, webParaImprimir, type SitioWeb } from "../../../primitivas/contacto/web";

/**
 * El contacto de la sucursal tal como lo congeló el comprobante al nacer (D-98): teléfono, correo y web, cada uno opcional.
 * Es lo que copió la base de la sucursal VIGENTE en ese momento; nunca se lee de la sucursal de hoy, así reimprimir da lo
 * mismo aunque la sucursal cambie después. La web ya viene canónica, sin esquema (D-99; el CHECK `sucursal_web_ck` lo asegura).
 */
export type ContactoCongelado = Readonly<{
  telefono: string | null;
  correo: string | null;
  web: SitioWeb | null;
}>;

/**
 * Lo que el modelo de impresión expone de ese contacto (D-98, D-99). SIN rótulos («Tel.», «Correo», «Web»): su texto no
 * está decidido. La web va dos veces porque el papel y el enlace son medios distintos (D-99): `texto` es la web sin
 * esquema, tal cual se guarda, para el papel; `enlace` es `https://` + la web, para PDF, mail y pantalla.
 */
export type ContactoImpreso = Readonly<{
  telefono: string | null;
  correo: string | null;
  web: Readonly<{ texto: string; enlace: string }> | null;
}>;

/**
 * El contacto a imprimir, o `null` si la sucursal no tenía ninguno de los tres (nada que mostrar: D-98 pide mostrar cada dato
 * solo si existe). Cómo se escribe y se enlaza la web sale de `webParaImprimir` y `enlaceDeLaWeb`, la única definición (D-99).
 */
export function contactoImpreso(contacto: ContactoCongelado): ContactoImpreso | null {
  if (contacto.telefono === null && contacto.correo === null && contacto.web === null) return null;
  return {
    telefono: contacto.telefono,
    correo: contacto.correo,
    web:
      contacto.web === null
        ? null
        : { texto: webParaImprimir(contacto.web), enlace: enlaceDeLaWeb(contacto.web) },
  };
}
