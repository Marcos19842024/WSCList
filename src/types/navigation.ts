// Tipos básicos para navigation
export type NavigationProp = {
  navigate: (screen: string, params?: any) => void;
  goBack: () => void;
};

// Tipos específicos
export type ScreenNavigationProp = NavigationProp;