import { cookies } from "next/headers";
import { PantallaDeInvitacion } from "../../../../../ui/plantillas/sesion/PantallaDeInvitacion";
import { COOKIE_DE_INVITACION } from "../../../../../servidor/cookies";
import { sesionDelPedido } from "../../../../../servidor/sesion";
import { aceptarInvitacionAccion, ingresarConGoogleAccion } from "../../acciones";

type Consulta = Promise<Record<string, string | string[] | undefined>>;

const LARGO_MAXIMO_DEL_TOKEN = 512;

// `/invitacion?t=…`: la única puerta del primer gerente. Sin sesión, primero Google (el enlace queda en una
// cookie del servidor mientras tanto: el token no viaja en la dirección de retorno). Con sesión, aceptar.
// NO acepta al abrirse: aceptar cambia datos, y una página que se abre (un buscador de enlaces del correo, una
// precarga) no tiene que cambiarlos. La acción de aceptar es la única que escribe.
export default async function PaginaDeInvitacion({ searchParams }: { searchParams: Consulta }) {
  const consulta = await searchParams;
  const delEnlace = consulta["t"];
  const token =
    (typeof delEnlace === "string" && delEnlace !== ""
      ? delEnlace
      : (await cookies()).get(COOKIE_DE_INVITACION)?.value) ?? "";
  const { puerta, sesion } = await sesionDelPedido();
  const marca = puerta.marca.nombre;
  if (token === "" || token.length > LARGO_MAXIMO_DEL_TOKEN) {
    return <PantallaDeInvitacion estado="SIN_ENLACE" marca={marca} />;
  }
  if (sesion === null) {
    return (
      <PantallaDeInvitacion
        estado="SIN_SESION"
        marca={marca}
        token={token}
        accionDeIngreso={ingresarConGoogleAccion}
      />
    );
  }
  return (
    <PantallaDeInvitacion
      estado="CON_SESION"
      marca={marca}
      aceptar={aceptarInvitacionAccion.bind(null, token)}
    />
  );
}
