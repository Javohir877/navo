package uz.navo.player;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NavoMediaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
