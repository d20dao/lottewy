export const discordMentions = { parse: [] as string[] };
export const discordText = (text: string) =>
  text.replace(/[\\`*_{}\[\]()<>~|]/g, "\\$&");
