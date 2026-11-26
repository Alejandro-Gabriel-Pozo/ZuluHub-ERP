import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import {
  cargarLasCuentasDeFotos,
  nuevaClaveDeCuentaDeFotos,
} from "../../../../../../../servidor/cuentas-de-fotos";
import { armarLasCuentasDeFotos } from "../../../../../../../ui/plantillas/carta/modelo-de-cuentas-de-fotos";
import { PantallaDeCuentasDeFotos } from "../../../../../../../ui/plantillas/carta/PantallaDeCuentasDeFotos";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import {
  declararLaCuentaAccion,
  retirarLaCuentaAccion,
} from "../../../../acciones-de-cuentas-de-fotos";

// `/catalogo/carta-en-linea/cuentas-de-fotos`: las cuentas del proveedor de imágenes que la empresa declara (0102). La empresa y la persona las pone el servidor y el permiso
// (`vidrieras.administrar_cuentas_de_imagen`) lo decide la consulta o el caso de uso; sin permiso sale el motivo del guard y ningún dato. La página fija UNA clave de declaración al abrirse y liga a cada
// retiro la cuenta y su versión: el doble toque y el reintento son un solo gesto.
export default async function PaginaDeLasCuentasDeFotos() {
  return pantallaDeOperacion(
    { titulo: "catalogo.cuentas_de_fotos.titulo" },
    async ({ contexto }) => {
      const respuesta = await cargarLasCuentasDeFotos(contexto);
      if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
      const cuentas = armarLasCuentasDeFotos(respuesta.dato);
      return (
        <PantallaDeCuentasDeFotos
          cuentas={cuentas}
          accionDeDeclarar={declararLaCuentaAccion.bind(null, {
            claveDeIdempotencia: nuevaClaveDeCuentaDeFotos(),
          })}
          accionesDeRetirar={Object.fromEntries(
            cuentas.cuentas.map((c) => [
              c.id,
              retirarLaCuentaAccion.bind(null, { id: c.id, versionEsperada: c.version }),
            ]),
          )}
        />
      );
    },
  );
}
