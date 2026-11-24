import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cargarLaListaDeUsuarios } from "../../../../../../servidor/usuarios";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { armarLaListaDeUsuarios } from "../../../../../../ui/plantillas/usuarios/modelo-de-usuarios";
import { PantallaDeListaDeUsuarios } from "../../../../../../ui/plantillas/usuarios/PantallaDeListaDeUsuarios";

// `/cuenta/usuarios` (tramo U1, solo lectura): quienes tienen acceso a la empresa y sus invitaciones pendientes. Abrirlo solo lee. La empresa y la persona salen de la sesión;
// el permiso (`usuarios.ver`: gerente y administrador) lo decide el servidor dentro de la consulta. Sin permiso o con una falla sale el mensaje genérico del catálogo, sin filas ni botones.
export default async function PaginaDeUsuarios() {
  return pantallaDeOperacion({ titulo: "usuarios.lista.titulo" }, async ({ contexto }) => {
    const lista = await cargarLaListaDeUsuarios(contexto);
    if (!lista.ok) return <ErrorDelDetalle error={lista.error} />;
    return <PantallaDeListaDeUsuarios lista={armarLaListaDeUsuarios(lista.dato)} />;
  });
}
