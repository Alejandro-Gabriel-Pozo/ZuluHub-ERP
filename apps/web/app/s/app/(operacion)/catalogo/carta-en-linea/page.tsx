import { redirect } from "next/navigation";
import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import {
  cargarLaCartaEnLinea,
  nuevaClaveDeCarta,
  sucursalDeLaCarta,
} from "../../../../../../servidor/carta-en-linea";
import { ofertaDeLaCartaEnLinea } from "../../../../../../servidor/modulos";
import { empresaDelPedido } from "../../../../../../servidor/sesion";
import { armarLaCartaEnLinea } from "../../../../../../ui/plantillas/carta/modelo-de-carta-en-linea";
import { PantallaDeCartaEnLinea } from "../../../../../../ui/plantillas/carta/PantallaDeCartaEnLinea";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { estadoDeLaCartaAccion, guardarLosTextosAccion } from "../../../acciones-de-carta-en-linea";

// `/catalogo/carta-en-linea`: la carta en línea de UNA sucursal (maqueta `carta-en-linea.html`, aprobada: filas 60 y 70 de `decisiones-del-dueno-2026-11.md`). La sucursal la fija el servidor (la elegida
// en el dispositivo, o la única abierta); sin ninguna, se pide elegirla en la pantalla que ya existe (`/sucursal`), nunca se asume «todas». La empresa y la persona las pone el servidor y los
// permisos (`vidrieras.ver` y, para cambiar algo, `vidrieras.editar` / `publicar_en_linea` / `retirar_de_linea`) los decide la consulta o el caso de uso; sin permiso o sin la perilla
// `vidriera_por_qr` sale el motivo del guard. La página fija UNA clave de creación al abrirse y liga a las acciones la carta, la sucursal mostrada y su versión: el doble toque y el reintento son una sola alta.
export default async function PaginaDeLaCartaEnLinea() {
  return pantallaDeOperacion({ titulo: "catalogo.carta.titulo" }, async ({ contexto }) => {
    const sucursalId = await sucursalDeLaCarta(contexto);
    if (sucursalId === "") redirect("/sucursal");
    const { puerta } = await empresaDelPedido();
    const respuesta = await cargarLaCartaEnLinea(contexto, sucursalId, puerta.marca.hostDeApp);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const dato = respuesta.dato;
    const carta = armarLaCartaEnLinea(dato, await ofertaDeLaCartaEnLinea(contexto));
    const existente = dato.carta;
    return (
      <PantallaDeCartaEnLinea
        carta={carta}
        accionDeGuardar={guardarLosTextosAccion.bind(null, {
          cartaId: existente === null ? nuevaClaveDeCarta() : existente.id,
          sucursalId,
          versionEsperada: existente === null ? null : existente.version,
        })}
        accionDeEstado={
          existente === null || carta.alternar === null
            ? null
            : estadoDeLaCartaAccion.bind(null, {
                cartaId: existente.id,
                sucursalId,
                versionEsperada: existente.version,
                estado: carta.alternar.estadoPedido,
              })
        }
      />
    );
  });
}
