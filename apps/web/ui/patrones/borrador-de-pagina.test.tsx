import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { leerCamposDeLaPagina, restaurarCamposDeLaPagina } from "./borrador-de-pagina";

/** Lo tipeado en la página que se guarda al vencer la sesión y vuelve después: solo texto, nunca secretos. */
function Formulario() {
  return (
    <>
      <main>
        <form>
          <input aria-label="Nota" name="nota" defaultValue="medialunas" />
          <textarea aria-label="Detalle" name="detalle" defaultValue="sin azúcar" />
          <select aria-label="Mesa" name="mesa" defaultValue="4">
            <option value="3">3</option>
            <option value="4">4</option>
          </select>
          <input aria-label="Vacío" name="vacio" defaultValue="" />
          <input aria-label="Sin nombre" defaultValue="sin name" />
          <input aria-label="Contraseña" name="clave_de_acceso" defaultValue="secreta" />
          <input aria-label="Pass" type="password" name="pass" defaultValue="secreta" />
          <input type="hidden" name="oculto" defaultValue="x" />
          <input aria-label="Aviso" type="checkbox" name="avisar" defaultChecked />
          <input aria-label="Desactivado" name="dos" defaultValue="no" disabled />
        </form>
      </main>
      <input aria-label="Fuera" name="fuera_de_main" defaultValue="x" />
    </>
  );
}

describe("borrador de la página", () => {
  it("lee los campos de texto del contenido: nada de secretos, ocultos, casillas, vacíos ni desactivados", async () => {
    const { container } = await render(<Formulario />);
    expect(leerCamposDeLaPagina(container)).toEqual({
      nota: "medialunas",
      detalle: "sin azúcar",
      mesa: "4",
    });
  });

  it("restaura lo guardado en los campos que sigan estando, y no toca los demás", async () => {
    const { container } = await render(<Formulario />);
    restaurarCamposDeLaPagina(
      { nota: "dos facturas", mesa: "3", detalle: "sin azúcar", inexistente: "x" },
      container,
    );
    const valor = (nombre: string) =>
      (container.querySelector(`[name=${nombre}]`) as HTMLInputElement).value;
    expect(valor("nota")).toBe("dos facturas");
    expect(valor("mesa")).toBe("3");
    expect(valor("detalle")).toBe("sin azúcar");
    expect(valor("pass")).toBe("secreta");
  });
});
