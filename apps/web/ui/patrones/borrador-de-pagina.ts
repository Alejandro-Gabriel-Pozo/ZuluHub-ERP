import { camposGuardables, type Borrador } from "./borrador";

/**
 * Lo tipeado en la página que se conserva si la sesión vence ([01] §6.4: «perder el carrito en silencio»
 * está prohibido). Lee los campos de texto del contenido (`main`) por su `name` y los vuelve a escribir al
 * volver, sin que cada pantalla tenga que enterarse. Nunca contraseñas, ocultos, archivos ni los campos
 * cuyo nombre parece un secreto (`camposGuardables`). Marcas y opciones (checkbox, radio) quedan para
 * cuando una pantalla real las necesite: en v1 no hay formularios largos.
 */
const TIPOS_QUE_NO_SE_GUARDAN = new Set([
  "password",
  "hidden",
  "file",
  "checkbox",
  "radio",
  "submit",
  "button",
  "reset",
  "image",
]);

function camposDe(
  raiz: ParentNode,
): (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[] {
  return [
    ...raiz.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "main input[name], main textarea[name], main select[name]",
    ),
  ].filter(
    (campo) =>
      !(campo instanceof HTMLInputElement && TIPOS_QUE_NO_SE_GUARDAN.has(campo.type)) &&
      campo.disabled === false,
  );
}

export function leerCamposDeLaPagina(raiz: ParentNode = document): Borrador {
  const campos: Record<string, string> = {};
  for (const campo of camposDe(raiz)) {
    if (campo.value !== "") campos[campo.name] = campo.value;
  }
  return camposGuardables(campos);
}

/** Vuelve a escribir lo guardado en los campos que sigan estando; avisa a React con un `input` real. */
export function restaurarCamposDeLaPagina(borrador: Borrador, raiz: ParentNode = document): void {
  for (const campo of camposDe(raiz)) {
    const guardado = borrador[campo.name];
    if (guardado === undefined || campo.value === guardado) continue;
    const prototipo =
      campo instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : campo instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLSelectElement.prototype;
    // El `set` nativo, no la propiedad: React ignora un `value` fijado directo en un campo controlado.
    Object.getOwnPropertyDescriptor(prototipo, "value")?.set?.call(campo, guardado);
    campo.dispatchEvent(
      new Event(campo instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  }
}
