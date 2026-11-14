import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cargarElContactoDeLaSucursal } from "../../../../../../servidor/contacto-de-sucursal";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { PantallaDeContactoDeLaSucursal } from "../../../../../../ui/plantillas/sesion/PantallaDeContactoDeLaSucursal.cliente";
import { RUTAS_DE_CUENTA } from "../../../../../../ui/plantillas/sesion/rutas-de-cuenta";
import { guardarContactoDeSucursalAccion } from "../../../acciones-de-contacto-de-sucursal";

// `/cuenta/contacto-de-la-sucursal` (D-113, alcance A): teléfono, correo y web de la sucursal elegida en este dispositivo. Abrirlo solo lee.
// El servidor decide la sucursal, el permiso y la validez de cada dato; lo que no deja leer (sin permiso, sin sucursal elegida) se dice
// con su texto del catálogo, sin campos ni botones.
export default async function PaginaDeContactoDeLaSucursal() {
  return pantallaDeOperacion({ titulo: "sucursal.contacto_titulo" }, async ({ contexto }) => {
    const ficha = await cargarElContactoDeLaSucursal(contexto);
    if (!ficha.ok) return <ErrorDelDetalle error={ficha.error} />;
    const { id, nombre, version, contacto } = ficha.dato;
    return (
      <PantallaDeContactoDeLaSucursal
        sucursalId={id}
        nombre={nombre}
        version={version}
        contacto={contacto}
        guardar={guardarContactoDeSucursalAccion}
        rutaAlGuardar={RUTAS_DE_CUENTA.cuenta}
        rutaAlCancelar={RUTAS_DE_CUENTA.cuenta}
      />
    );
  });
}
