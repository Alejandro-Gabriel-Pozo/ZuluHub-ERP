import type { AccionDeFormulario } from "../../patrones/FormularioDeAccion.cliente";
import { Pila } from "../../primitivas/Pila";
import { FormularioDeCuentaDeFotos } from "./FormularioDeCuentaDeFotos.cliente";
import { FormularioDeRetiroDeCuentaDeFotos } from "./FormularioDeRetiroDeCuentaDeFotos.cliente";
import estilos from "./PantallaDeCartaEnLinea.module.css";
import type { CuentasDeFotosArmadas } from "./modelo-de-cuentas-de-fotos";

export type PropsDePantallaDeCuentasDeFotos = Readonly<{
  cuentas: CuentasDeFotosArmadas;
  /** Declarar, ya ligada a la clave de idempotencia que fijó la página. */
  accionDeDeclarar: AccionDeFormulario;
  /** Una acción de retirar por cuenta, ya ligada a su id y a la versión que se vio (misma clave que `cuentas.cuentas[].id`). */
  accionesDeRetirar: Readonly<Record<string, AccionDeFormulario>>;
}>;

/**
 * «Conectá tu cuenta de fotos»: el formulario de declarar y, debajo, las cuentas activas de la empresa, cada una con su retiro. Sin textos propios: todos llegan resueltos. El `h1` lo pone el armazón.
 * Las cuentas retiradas no se listan. Si la acción de una cuenta falta (no debería), esa fila no ofrece el retiro: nunca se arma una acción a mano.
 */
export function PantallaDeCuentasDeFotos({
  cuentas,
  accionDeDeclarar,
  accionesDeRetirar,
}: PropsDePantallaDeCuentasDeFotos) {
  return (
    <div className={estilos["raiz"]}>
      <FormularioDeCuentaDeFotos formulario={cuentas.declarar} accion={accionDeDeclarar} />
      <Pila separacion={4}>
        {cuentas.cuentas.map((c) => {
          const accion = accionesDeRetirar[c.id];
          return (
            <Pila key={c.id} separacion={2}>
              <p className={estilos["direccion"]}>{c.cuenta}</p>
              {accion === undefined ? null : (
                <FormularioDeRetiroDeCuentaDeFotos formulario={cuentas.retirar} accion={accion} />
              )}
            </Pila>
          );
        })}
      </Pila>
    </div>
  );
}
