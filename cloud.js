// Optional cloud accounts using Supabase. Does nothing unless config.js has a URL and key.
// Each deck is one row in the "decks" table: { id, user_id, data (deck JSON), updated_at }.
(function () {
  const config = window.FLASHCARDS_CONFIG || {};
  const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
  const authListeners = [];

  const Cloud = {
    enabled: Boolean(config.supabaseUrl && config.supabaseAnonKey),
    user: null,
    client: null,

    onAuthChange(fn) {
      authListeners.push(fn);
    },

    async init() {
      if (!this.enabled) return;
      const { createClient } = await import(SDK);
      this.client = createClient(config.supabaseUrl, config.supabaseAnonKey);
      const { data } = await this.client.auth.getSession();
      this.user = data.session ? data.session.user : null;
      this.client.auth.onAuthStateChange((_event, session) => {
        this.user = session ? session.user : null;
        authListeners.forEach((fn) => fn());
      });
    },

    signUp(email, password) {
      return this.client.auth.signUp({ email, password });
    },

    signIn(email, password) {
      return this.client.auth.signInWithPassword({ email, password });
    },

    signOut() {
      return this.client.auth.signOut();
    },

    async fetchDecks() {
      const { data, error } = await this.client.from('decks').select('id, data');
      if (error) throw error;
      return data;
    },

    async saveDeck(deck) {
      const { error } = await this.client
        .from('decks')
        .upsert({ id: deck.id, data: deck, updated_at: new Date().toISOString() });
      if (error) throw error;
    },

    async removeDeck(id) {
      const { error } = await this.client.from('decks').delete().eq('id', id);
      if (error) throw error;
    },
  };

  window.Cloud = Cloud;
})();
